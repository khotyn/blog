---
title: "Java 19 Structured Concurrency"
date: 2022-06-22T21:09:11+08:00
---
前一篇文章介绍了 Java 19 的 Virtual Thread，有了 Virtual Thread，一些 Java 应用的吞吐可以得到很高的提升。这一篇文章会介绍一下 Java 19 的 Structured Concurrency，我认为一旦 Structured Concurrency 成熟，很多做并发执行的工具包都可以不用搞了，为什么怎么说呢？先来了解下什么是 Structured Concurrency 吧。

简单的来讲，Structured Concurrency 就像 Structured Programming（结构化编程一样），在结构化编程的代码里面，代码不再存在 GOTO，就是从上而下执行的，通过结构化编程，代码变得更加清晰，更加易读。而在 Structured Concurrency 这种编程范式中，也让并发代码的编写变得更加清晰，更加简单，更加易懂。在 Java 19 中，Structured Concurrency 的核心类是 `StructuredTaskScope` ，它核心解决了三个问题：


1. 在一个 `StructuredTaskScope`  的 Scope 内，所有的并发任务的执行时间不会超过这个 scope。
2. 在 Scope 内的所有并发任务，执行起来就像一个原子操作一样，如果整个 scope 被 shutdown 或者 cancel 掉，这个 scope 内所有的并发任务都会被 cancel 掉。
3. `StructuredTaskScope` 让并发的异常处理变得更加简单了，如果其中的一个并发任务跑出了异常，你可以非常方便地就获取到这个异常信息。

`StructuredTaskScope` 有两个子类，分别应对两个场景，一个场景是所有的子任务都成功才算成功，名字是 `ShutdownOnFailure` ，下面这段代码演示了这个场景：

```java
private static String shutdownOnFailure() throws InterruptedException, ExecutionException {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        Future<String> msgOne = scope.fork(() -> {
            return "Hello";
        });
        Future<String> msgTwo = scope.fork(() -> {
            return "World";
        });
        scope.join();
        scope.throwIfFailed();
        return msgOne.get() + msgTwo.get();
    }
}
```


上面这段代码中，new 了一个 `ShutdownOnFailure` 的 scope，里面有两个子任务，调用 join 方法等待结果执行结束，然后调用 throwIfFailed 就可以处理异常，一旦任何一个子任务出现异常，就往外抛，最后在调用两个 Future 的 get 的方法来拿到结果。

如果我们把上面的代码再修改一下，变成如下这样：

```java
private static String shutdownOnFailure() throws InterruptedException, ExecutionException {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        Future<String> msgOne = scope.fork(() -> {
            Thread.sleep(1000);
            System.out.println("Bye");
            return "Hello";
        });
        Future<String> msgTwo = scope.fork(() -> {
            throw new RuntimeException("Hello");
        });
        scope.join();
        scope.throwIfFailed();
        return msgOne.get() + msgTwo.get();
    }
}
```


在上面的代码中，第二个任务直接抛出了一个异常，这个异常会直接把第一个任务也 cancel 掉，第一个任务也就不会输出 Bye，这就是 StructuredTaskScope 的原子性。

`StructuredTaskScope` 的另一个子类是 `ShutdownOnSuccess` ，在这个子类中，只要一个子任务成功，整个 scope 就成功了，并且会把其他的子任务都 cancel 掉，看如下的代码：

```java
private static String shutdownOnSuccess() throws InterruptedException, ExecutionException {
    try (var scope = new StructuredTaskScope.ShutdownOnSuccess<String>()) {
        scope.fork(() -> {
            Thread.sleep(100);
            return "Hello";
        });
        scope.fork(() -> {
            Thread.sleep(200);
            System.out.println("Bye");
            return "World";
        });
        scope.join();
        return scope.result();
    }
}
```


在上面的代码中，第一个任务先执行完，第二个任务就被取消了，Bye 也不会输出。

通过上面的这两种方式，StructuredTaskScope 大大简化了并发代码的编写，目前很多通过 ThreadPool 做得并发执行包，都可以直接被 StructuredTaskScope 替代了，期待 Java 的 Structured Concurrency 早日完善，早日让 Javaer 享受到。

参考：

* [https://www.infoq.com/news/2022/06/java-structured-concurrency/](https://www.infoq.com/news/2022/06/java-structured-concurrency/)
* [https://250bpm.com/blog:71/](https://250bpm.com/blog:71/)
