---
title: "Java 19 Virtual Thread 预览"
date: 2022-06-20T20:57:46+08:00
---
Java 19 在最近的 Early Access 版本中带来了 Virtual Thread 的预览版本，所谓的 Virtual Thread，就是协程，相信玩过 Golang 的同学对于 Golang 中的 Goroutine 肯定非常熟悉，我也碰到过一些应用，因为追求高吞吐，把应用从 Java 改写成 Golang，经过了这么多年，Java 也终于带来了自己的协程，虽然还只是一个预览版本，😅

Java 的 Virtual Thread 用起来非常简单，在 Java 19 中，直接提供了一个 `Thread.ofVirtual()` 的方法，这个方法返回一个 Builder，用于构建 VirtualThread，而 Virtual Thread 就是 Thread 的一个子类，所以实际上用起来是和 Thread 一摸一样的。

```java
@PreviewFeature(feature = PreviewFeature.Feature.VIRTUAL_THREADS)
public static Builder.OfVirtual ofVirtual() {
    PreviewFeatures.ensureEnabled();
    return new ThreadBuilders.VirtualThreadBuilder();
}
```


除了 `Thread.ofVirtual` 这种方式之外，JUC 里面的最常见创建线程池的 `Executors` 也提供了创建“协程池”的方式，就是下面这个方法：

```java
@PreviewFeature(feature = PreviewFeature.Feature.VIRTUAL_THREADS)
public static ExecutorService newVirtualThreadPerTaskExecutor() {
    ThreadFactory factory = Thread.ofVirtual().factory();
    return newThreadPerTaskExecutor(factory);
}
```


从 `newVirtualThreadPerTaskExecutor` 这个方法名可以看出，这个 Executor 实际上并不是一个“协程池”，而是每往这个 Executor 里面提交一个任务，它就新建一个 Virtual Thread，之所以因为这么做，是因为 Virtual Thread 的开销相对 Java 原来的线程（Platform Thread）来说小很多，所以直接每个任务一个 Virtual Thread 就好了。

在实现层面上，Virtual Thread 的调度器是通过一个 ForkJoinPool 来实现的，当需要去跑一个 Virtual Thread 的时候，调度器会把这个 Virtual Thread 绑定到一个 Carrier Thread（一个真正的 Java 线程）上，当 Virtual Thread 运行到一些阻塞的方法时，调度器会把这个 Virtual Thread 从原来的 Carrier Thread 上面解绑。

当然，现在 Virtual Thread 的实现还有不少的瑕疵，假如你在 Virtual Thread 内运行 `Object.wait()` ，那么这个 Virtual Thread 实际上直接把它的 Carrier Thread 给 Block 了，并不会从 Carrier Thread 解绑掉。

下面的这段代码演示了在 Virtual Thread 中使用 `Object.wait()` 的情况：

```java
public class Main {
    private static final Executor virtualThreadExecutor = Executors.newVirtualThreadPerTaskExecutor();

    public static void main(String[] args) throws InterruptedException, NoSuchFieldException, IllegalAccessException, InvocationTargetException, NoSuchMethodException {
        System.out.println("Start");
        getVirtualThreadFactoryInfo();
        for (int i = 0; i < 300; i++) {
//            reentranceLockInVirtualThread();
            waitInVirtualThread();
        }
        Thread.sleep(5000);
        System.out.println("After");
        getVirtualThreadFactoryInfo();
    }

    private static void reentranceLockInVirtualThread() {
        virtualThreadExecutor.execute(() -> {
            ReentrantLock lock = new ReentrantLock();
            lock.lock();
        });
    }

    private static void waitInVirtualThread() {
        virtualThreadExecutor.execute(() -> {
            try {
                Object obj = new Object();
                synchronized (obj) {
                    obj.wait();
                }
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        });
    }

    private static void getVirtualThreadFactoryInfo() throws NoSuchFieldException, IllegalAccessException, InvocationTargetException, NoSuchMethodException {
        Thread vt = Thread.ofVirtual().start(() -> {
        });
        Field schedulerField = vt.getClass().getDeclaredField("DEFAULT_SCHEDULER");
        schedulerField.setAccessible(true);
        ForkJoinPool fjp = (ForkJoinPool) schedulerField.get(vt.getClass());
        System.out.println("PoolSize:" + fjp.getPoolSize() + ";QueueSize:" + fjp.getQueuedSubmissionCount());
    }
}
```


上述这段代码启动了 300 个 Virtual Thread，每个 Virtual Thread 里面都调用了 `Object.wait()` ，在调用前后，我们把 Virtual Thread 的 ForkJoinPool 的情况给打印了出来，这个 ForkJoinPool 的 parallelism 是 8，maximumPoolSize 是 256，最后的输出如下：

```shell
Start
PoolSize:1;QueueSize:0
After
PoolSize:256;QueueSize:45
```


从结果可以看到，刚开始 ForkJoinPool 的 Worker 线程是 1 个，在我们启动了 300 个 Virtual Thread 之后，PoolSize 直接达到了最大的 256，并且 Queue 中还有 45 个 Virtual Thread 没有被处理，说明 `Object.wait()` 实际上把 Virtual Thread 的 Carrier Thread 给 Block 了。

目前绕过这个问题的方式是尽量地不要在 Virtual Thread 中使用 `Object.wait()` ，而是用 `ReentrantLock` 。如果我们把上面 Main 的方法中的 `waitInVirtualThread` 换成上述代码中的 `reentranceLockInVirtualThread` ，那么就可以得到如下的结果：

```shell
Start
PoolSize:1;QueueSize:0
After
PoolSize:8;QueueSize:0
```


ForkJoinPool 的线程数量只是涨到了 parallelism 大小，可见在 Virtual Thread 中调用 `ReentrantLock.lock()` 的确会把 Virtual Thread 从 Carrier Thread 中解绑掉，如果我们查看 `LockSupport` 的 park 和 unpark 方法，的确也可以看到相关的处理代码：

```java
public static void park(Object blocker) {
    Thread t = Thread.currentThread();
    setBlocker(t, blocker);
    try {
        if (t.isVirtual()) {
            VirtualThreads.park();
        } else {
            U.park(false, 0L);
        }
    } finally {
        setBlocker(t, null);
    }
}
```


虽然 Virtual Thread 现在还不是非常完美，但是的确让众多的 Javaer 看到了希望。其实 DragoonWell 也提供了 Wisp 这样的协程解决方案，不过相比于 Wisp 这种无侵入的方法，我更喜欢 Java 19 这种有侵入的方案，Java 19 的这种方式的好处是让写代码的人知道自己用得就是协程，而 Wisp 这种无侵入的方案，写代码的人写的时候是线程，跑的时候是协程，线程和协程毕竟还是有差别，在编写代码的时候没有意识的话，跑起来可不知道会有什么问题。
