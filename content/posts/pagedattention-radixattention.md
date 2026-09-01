---
title: "PagedAttention 与 RadixAttention"
date: 2026-09-01T15:45:00+08:00
---

在大模型领域里面，各种各样的名词非常繁多。Attention 机制是这一波大模型发展中极其重要的一个创新，因此，以 Attention 为结尾的名词也特别多。有些是 Attention 算法上的创新，而像 PagedAttention 与 RadixAttention，则分别是 vLLM 和 SGLang 论文中的核心“创新”。

注意我给“创新”打上了引号，是因为无论是 PagedAttention 还是 RadixAttention，都不算非常大的创新。vLLM 的核心成员之一游凯超，也在张小珺对他的采访中提到，要不是当时 PagedAttention 的实验做得比较扎实，可能都上不了顶会论文。

PagedAttention 和 RadixAttention 的名字虽然非常接近，而且都是推理引擎中的机制，但其实完全不是一回事儿。

PagedAttention 本质上是一种显存分配机制，而 RadixAttention 则是一种 Prefix Cache 复用机制。

## PagedAttention

PagedAttention 是 vLLM 提出的一种显存管理机制。在大模型推理过程中，Attention 计算中的 KV Cache 需要占用大量显存，并且 KV Cache 的大小与 Prefill 和 Decode 阶段的 Token 数量密切相关。

如果 Attention 计算中的 KV Cache 都要申请连续显存，那么每次应该申请多大的空间就成了一个问题。显存需求会随着 Decode 的进行而不断增加：申请多了容易造成浪费，申请少了又需要动态扩容。而且，随着显存被不断申请和释放，还会面临严重的显存碎片化问题。因此，如何高效管理 Attention 计算中 KV Cache 使用的显存，就成了一个需要解决的问题。

为了解决这个问题，PagedAttention 借鉴了操作系统中内存分页的思想，把显存划分成一个个 Block，并引入逻辑 KV Block 的概念，再通过 Block Table 将逻辑 KV Block 映射到具体的物理 KV Block。Block Table 还带有 filled 标记，用来表示这个 Block 是否已经写满。整个 PagedAttention 的机制如下图所示：

![PagedAttention 的机制](/blog/pagedattention-radixattention/1.webp)

通过 PagedAttention，vLLM 解决了 Attention 计算中 KV Cache 显存使用的几个问题：

- **无需显式申请连续显存：** 有了 PagedAttention，我们就不需要连续地申请显存，只需要按照 Block 来申请即可。默认的 Block Size 是 16。论文中的测试表明，当 Block Size 为 16 时，GPU 利用率与显存碎片化之间的平衡最好。
- **减少显存浪费：** 因为不再要求显存连续，所以每次只需要申请足够使用的 KV Block。Prefill 阶段可以一次性申请足以容纳当前 KV Cache 的 KV Block；到了 Decode 阶段，则查看 Block Table 中的 filled 标记，如果最后一个 Block 已经写满，就申请新的 Block。在这种情况下，浪费的显存最多只有 1 个 KV Block。
- **方便后续做 Prefix Cache：** 有了 PagedAttention 之后，实现 Prefix Cache 也会更加方便。我们可以针对一个 Block 中的 Token 计算 Hash；如果 Hash 相同，就可以复用这一部分 Block。这样，每个请求可以拥有自己的逻辑 KV Block，而底层的物理 KV Block 则可以通过 Block Table 的映射在不同请求之间共享。

不过，因为显存被分块，如何让 Attention 的计算过程更加高效，还需要进一步优化。vLLM 在早期版本中专门针对 PagedAttention 的场景编写了对应的 CUDA Kernel，以提升计算效率。在最近的版本中，这部分 CUDA Kernel 默认换成了 FlashInfer、FlashAttention 等后端。（关于这件事情，小红书上有人还煞有介事地说 vLLM 移除了 PagedAttention。虽然 vLLM 的 Issue 写的的确是 Delete PagedAttention，但这样写真的还是挺无耻的。）

## RadixAttention

RadixAttention 是 SGLang 提出的一种高效复用 Prefix Cache 的机制。RadixAttention 中的 Radix 指的是 Radix Tree。Radix Tree 是一种特殊的“压缩”树，它会把公共前缀放到同一个节点上，所以树的深度通常会比普通的 Trie 更浅一些。

RadixAttention 会把 Prompt 的公共前缀组织成一棵 Radix Tree，机制如下图所示（来自 SGLang 的论文）：

![RadixAttention 的机制](/blog/pagedattention-radixattention/2.webp)

这张图中，绿色框代表新节点，蓝色框代表复用的节点，橙色框代表被驱逐的节点。

在（1）中，整个 Radix Tree 是空的。在（2）中，系统收到一组 System Prompt、User Prompt 和 LLM Answer，并将对应的 KV Cache 缓存到 Radix Tree 中。在（3）中，用户继续追问，LLM 继续回答，Radix Tree 增加了本轮对话对应的新节点。在（4）中，用户新开了一个 Session，并复用了 System Prompt 对应的前缀节点，因此整个 Radix Tree 进行了调整。在（5）中，用户继续在新 Session 上追问，此时显存不足，于是系统开始驱逐前面请求占用的部分 KV Cache。驱逐从叶子节点开始，因为越靠近叶子，节点的复用程度越低，驱逐后对 Cache 命中率的影响也越小。

通过 Radix Tree，SGLang 可以高效复用 Attention 计算中的 KV Cache。整个 Radix Tree 的结构存储在 CPU 中，开销也比较可控。

在 RadixAttention 的基础上，SGLang 还配套实现了 Cache-Aware Scheduling（LPM）。它按照前缀匹配长度对请求进行排序：匹配长度越长，请求的优先级越高。通过这种方式，可以提升 Cache 命中率和系统吞吐。不过，这种方式只有在公共前缀较多时效果才好，否则可能导致其他请求被饿死。因此，SGLang 当前默认仍采用与 vLLM 相同的 FCFS（First-Come, First-Served）调度策略，以保证请求调度的公平性。

## 总结

可以看到，PagedAttention 和 RadixAttention 解决的并不是同一维度的问题：一个解决显存利用效率问题，另一个解决 Prefix Cache 复用问题。事实上，vLLM 也在 PagedAttention 的基础上，通过 Hash 机制实现了 Prefix Cache 复用；SGLang 则在 RadixAttention 的底层通过分页来管理显存。殊途同归。
