---
title: "大模型推理中投机推理的相关技术"
date: 2026-08-18T14:54:09+08:00
---

## 为什么需要投机推理

在大模型推理中，一般上分成两个部分，一个是 Prefill，根据用户输入的 Prompt 计算出第一个 Token，然后进行 Decode 的过程，不断的递归的 Decode 下一个 Token，直到 Decode 出结束标记位或者达到 Max Output Token。

在这个过程中，Decode 是一个 Token，一个 Token 来 Decode 的，没办法像 Prefill 一样，一次性对所有的输入的 Token 做计算。这个过程也得每生成一个 Token，走一遍模型的神经网络，随着模型尺寸越来越大，Decode 的消耗也非常大。因此大家自然而然想要想办法看能否有办法做并行。

## 投机推理相关技术的总体思路

投机推理的方法有很多，但是大概的思路上都类似的，通过一种相对来说低成本的技术来得到多个 Token，然后让 Target Model（也就是主模型）对得到的多个 Token 进行 Verify，而 Verify 的过程本质其实就是一次 forward，也就是一次 forward 就得到了多个 Token。

## 如何得到多个 Token

如何得到多个 Token，方式方法也非常多，包括用小尺寸的模型，EAGLE，MTP，以及最近的 DeepSeek 推出的 DSpark 等技术都是类似的。

### 直接用小模型做 Draft Model

我们想到最简单的方式就是直接用小尺寸的模型来作为 Draft Model，Target Model 对 Draft Model 产出的 Token 进行 Verify，但是，这里面有一些约束，Draft Model 和 Target Model 的词表和 Tokenizer 必须保持一致，这样 Draft Model 产生的 Token ID 才能够直接交给 Target Model 来做验证。

因此，这种情况下，一般上会选择一个家族的模型作为小尺寸的模型，比如说，同为 Qwen 模型，可以用大尺寸的模型作为 Target Model，小尺寸的模型作为 Draft Model。

### EAGLE

[EAGLE](https://arxiv.org/pdf/2401.15077) 是 2024 年初发表的一个投机推理的方法，其核心的思想是使用模型的倒数第二层（其实就是在进入 LM Head 之前）的 Hidden State，以及上一个 Token 的 Embedding 作为输入，通过一个特征融合层以及一个 Transformer Decode Layer 来对后续的 Token 来进行预测，如果需要一次性预测多个 Token，则递归地进行调用。

这种方式本质上用了一个输入和输出和 Target Model 一致的 Transformer 层来快速生成 Token。好处非常明显，因为公用 LM Head，所以词表完全一致，因为可以冻结 Target Model，单独训练 EAGLE 模型，所以理论上任何的模型都可以外挂训练出来一个 EAGLE 模型，灵活性也非常高。并且，这个 EAGLE 模型可以根据生产的实际上的 Prompt 来进行调整，使其 Token 的接收率更高。

当然，EAGLE 生成的 Token 可以是一个 Token 的树，也就是在每一个位置上留下多个候选词，EAGLE-2 对这个 Token 树进行了进一步的优化，可以根据置信度对 Token 树进行动态的调整。不过在我们的生产环境中实际测试下来，还是直接生成一个 Token 链效果更好。Token 树的方式也增加了 KV Cache 管理的复杂度，提升了工程的复杂度。

### MTP

MTP 是 Multi-Token Prediction 的缩写，它实际上和 EAGLE 非常类似，只是 MTP 是直接和模型一起训练出来的，MTP 层会拿着 Target Model 产生的 Hidden State 和新生成的 Token 的 Embedding 做 Projection，然后放到 MTP Transformer Layer 里面去做下一个 Token 的预测，最后再通过主模型的 LM Head 的到下一个 Token 的 Logits，如果需要预测多个，同样可以递归。

目前很多开源的模型权重已经带了自己的 MTP 层，有些还有多个，大部分都是一个 MTP 层，少部分的，比如 Kimi 并没有开放对应的 MTP 层，但是据说他们内部实际上有训练对应的 MTP 层，只是选择没有把这部分给开源出来。

### DFlash

前面看到，无论是 EAGLE，MTP，都是顺序地对下一个 Token 进行预测，因为它们还需要遵守自回归模型的规律。Draft Model 能否一次计算就可以得到更多的 Token？DFlash 就是干这个事情的。简单来讲，DFlash 就是用了一个 Diffusion 的模型来做 Draft Model，一次性预测多个 Token，但是，由于在一次性预测 Token 的时候，后续的 Token 并不知道前序的 Token 到底是什么，所以越往后的 Token 越容易质量的衰退。

### DSpark

因为 DFlash 本身存在一些缺陷，虽然产生 Draft Token 的速度更快了，但是如果 Token 的接收率上不去的话，相当于浪费了更多的算力。DFlash 的核心问题在于在预测的时候后续 Token 并不知道前序的 Token 是什么，所以后面的 Token 质量容易出现衰退。

DSpark 在 DFlash 的基础上做了进一步的改进，DSpark 是 DeepSeek 在 2026 年提出的投机推理的方法，主要做出了两项的改进：

1. 在 DFlash 的 Diffusion 的 Backbone 后面增加了一个 Markov Head，这个 Markov Head 相当于通过位置的关系对 Diffusion Block 产出的 Logits 进行修正，也就是在 Logits 上加上一个 Delta。这样的话，Token 的接收率更高。
1. DSpark 中还增加了一个 Confidence Head，顾名思义，这个 Head 的作用就是计算当前 Token 被 Target Model 接收的概率，再加上 Hardware-Aware Prefix Scheduler，结合接收概率，当前 Batch 的请求数量，实际的系统的吞吐等信息，来动态的决定可以送多少 Token 去做 Verify。

通过这种方式 DSpark 增加了 Draft Model 产生的 Token 被接收的概率，减少了 Target Model 的无效计算。根据 DeepSeek 中的论文中的数据，DSpark 无论比 DFlash 还是 EAGLE-3，平均的接收长度都提高了。但是实际中生产的表现还是待观察。

## 如何 Verify Token

Token 产生之后，剩下的就是 Verify 的动作，Verify 的动作其实非常简单，也就是把产生的 Token 一次性的送入 Target Model 做 forward，通过这个 forward，Draft Model 产生的每一个 Token 的位置的 Logits 就可以一次性地在这次计算中得到了，得到了之后，我们可以根据不同的算法去 Verify，比如 Greedy 的方式，看下这个 Draft Model 产生的这个 Token 在 Target Model 里面是不是也是最大的。Sample 的方式，对 Draft Model 产生的这个 Token 的采样概率和 Target Model 对于这个 Token 的采样概率进行比较，如果 Draft Model 的采样概率比 Target Model 的采样概率小一定的范围内，则接收。

## 总结

总结来讲，大模型推理中的投机推理，思想都是通过一个小的模型来轻量化生成多个 Token，然后通过 Target Model 一次性 forward 进行 Token 的 Verify，来减少产生 Token 的计算量。目前的创新中，Draft Model 的创新比较多，而 Verify 则基本上都是一样的。

## 参考文献

1. [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192)，Yaniv Leviathan、Matan Kalman、Yossi Matias，2022。
1. [EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty](https://arxiv.org/abs/2401.15077)，Yuhui Li、Fangyun Wei、Chao Zhang、Hongyang Zhang，2024。
1. [EAGLE-2: Faster Inference of Language Models with Dynamic Draft Trees](https://arxiv.org/abs/2406.16858)，Yuhui Li、Fangyun Wei、Chao Zhang、Hongyang Zhang，2024。
1. [Better & Faster Large Language Models via Multi-token Prediction](https://arxiv.org/abs/2404.19737)，Fabian Gloeckle 等，2024。
1. [DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437)，DeepSeek-AI，2024。
1. [DFlash: Block Diffusion for Flash Speculative Decoding](https://arxiv.org/abs/2602.06036)，Jian Chen、Yesheng Liang、Zhijian Liu，2026。
1. [DSpark: Confidence-Scheduled Speculative Decoding with Semi-Autoregressive Generation](https://arxiv.org/abs/2607.05147)，Xin Cheng 等，2026。
