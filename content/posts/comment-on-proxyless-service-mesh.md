---
title: "简评 Proxyless Service Mesh"
date: 2021-12-05T21:28:37+08:00
---

最近 Google 的 gRPC 团队支持了 Istio 的 Control Plane，并把这种架构称之为 Proxyless Service Mesh，国内很多公司也上了类似的架构，采用 Istio 的 Control Plane 来对接 bRPC，Dubbo 等 RPC 框架，也称之为 Proxyless Service Mesh，并且声称「Serivce Mesh 是一组服务间通信的能力标准（我想这里的标准就是指的是 Istio 的 Control Plane），实现了这些标准，就可以称之为 Service Mesh」，从上面的定义可以看出，现在所谓 Proxyless Service Mesh 就是 Istio 的 Control Plane 加上一个 RPC 框架。

Proxyless Service Mesh 这个词就让人觉得充满了云原生时代各种技术营销的味道，关于 Service Mesh 的定义，Service Mesh 的鼻祖 Bouyant 提出 Service Mesh 的时候就给了非常清晰的定义：

For all the hype, the service mesh is architecturally pretty straightforward. It’s nothing more than a bunch of userspace proxies, stuck “next” to your services (we’ll talk about what “next” means in a bit), plus a set of management processes.[[1]](https://buoyant.io/service-mesh-manifesto/)

Service Mesh 的这张被引用无数次的架构图更是说明了 Proxy 的关键：

![Image](/blog/service-mesh.png)

所以，**Service Mesh 最核心的价值就是它的 Proxy**，无论是 Sidecar 的形式还是 DaemonSet 的形式，有了 Proxy，我们才能够对整个微服务的治理能力做无痛的升级，没有 Proxy，永远都需要 SDK 的使用方去升级 SDK。所谓的 Proxyless Service Mesh 在我看来根本就不是 Service Mesh，声称「Service Mesh 是一组服务间通信的能力标准」更是对 Service Mesh 鼻祖 Bouyant 的侮辱，完全是蹭 Service Mesh 这个词这几年的热点。

那么 Istio 的 Control Plane + RPC 框架的这样一个架构到底有没有其存在的合理性，我认为是有的，有些业务场景的确对延迟非常敏感，如果本来服务治理能力是比较弱的话，的确可以借助 Istio 的 Control Plane 来提升服务治理的能力，这个架构的价值是要看 Istio 的 Control Plane 能够给你带来什么样的价值。当然，架构的合理归架构的合理，在取名字上，我觉得大可以大方的叫 gRPC with Istio Control Plane，bRPC with Istio Control Plane 即可，简单易懂，没有必要非得追潮流。

