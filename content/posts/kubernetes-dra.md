---
title: "Kubernetes DRA"
date: 2026-08-27T18:30:00+08:00
---

Kubernetes 的 DRA 是 Dynamic Resource Allocation 的缩写，这几年 GPU 调度的问题随着 AI 的这一波的兴起被放大。有些时候，我们需要把一张卡虚拟化成多张卡来给不同的 Workload 使用，以提升资源的利用效率，DRA 主要就是为了解决这些问题，类似 K8s 的 PVC 机制一样。

## DRA 机制的简单介绍

DRA 机制的大概流程如下：

在 Kubernetes 的节点上安装对应的 Device Resource Plugin（DaemonSet），这个 Plugin 可以把当前的节点的设备的各种信息组装成 ResourceSlice，然后通过 Kubernetes 的 APIServer 上报到 Kubernetes 中。一个典型的 ResourceSlice 如下：

```yaml
apiVersion: v1
items:
- apiVersion: resource.k8s.io/v1
  kind: ResourceSlice
  metadata:
    creationTimestamp: "2026-08-26T23:03:21Z"
    generateName: dra-lab-worker-gpu.example.com-
    generation: 2
    name: dra-lab-worker-gpu.example.com-nqxqq
    ownerReferences:
    - apiVersion: v1
      controller: true
      kind: Node
      name: dra-lab-worker
      uid: 01a70e63-36fd-4c23-8b8a-176847629cc2
    resourceVersion: "3542"
    uid: e3fd02aa-0c50-416c-beee-10f693559f54
  spec:
    devices:
    - attributes:
        driverVersion:
          version: 1.0.0
        index:
          int: 1
        model:
          string: LATEST-GPU-MODEL
        uuid:
          string: gpu-babab493-35cb-0367-015c-c8c7ac9e7055
      capacity:
        memory:
          value: 80Gi
      name: gpu-1
kind: List
metadata:
  resourceVersion: ""
```

可以看到上面的这个 YAML 中，这个模拟的 GPU 的设备里面包含了内存的信息。

对于工作负载来说，可以通过 ResourceClaim 来声明工作负载需要什么样的设备，一个典型的 ResourceClaim 如下：

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaim
metadata:
 name: some-gpu
 namespace: dra-tutorial
spec:
   devices:
     requests:
     - name: some-gpu
       exactly:
         deviceClassName: gpu.example.com
         selectors:
         - cel:
             expression: "device.capacity['gpu.example.com'].memory.compareTo(quantity('10Gi')) >= 0"
```

这个 ResourceClaim 声明了一个 CEL 的 Expression，表示我要 `gpu.example.com` 这个设备，并且要求它的可用的内存大于等于 10Gi。

然后在 Pod 的 Spec 中引用这个 ResourceClaim 即可，例子如下：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pod0
  namespace: dra-tutorial
  labels:
    app: pod
spec:
  containers:
  - name: ctr0
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args: ["export; trap 'exit 0' TERM; sleep 9999 & wait"]
    resources:
      claims:
      - name: gpu
  resourceClaims:
  - name: gpu
    resourceClaimName: some-gpu
```

在调度完成之后，你还可以看到 ResourceClaims 的状态从 pending 变成了 reserved，allocated。

## DRA 的一些潜在用处

可以看到，DRA 主要是能够让一个 Pod 去找能够满足它的设备资源，假设设备资源是 GPU，如果一个 Node 是一个 8 卡的 GPU，一个模型只需要单卡或者两卡或者四卡，那可以通过 DRA 来进行资源的切分，并且对应的 ResourceSlice 上还可以带上 NUMA/PCIe 等属性信息，通过 CEL 表达式进行亲和性的声明。如果对应的 GPU 还有虚拟化的支持，还可以直接在 ResourceSlice 上暴露出虚拟卡出来。

但是如果这个 Pod 直接就需要占满 8 卡，比如现在各种大尺寸的大模型，DRA 在这个点上的用处不大了。

不过 DRA 也不是完全没有用处，DRA 的机制可以直接在选择出满足条件的节点，再把 Pod 调度到节点上面去。如果是原来的基于 DevicePlugin + Topology Manager 的方案，调度器可能先把 Pod 调度到节点上，然后因为节点内无法满足条件而调度失败。从这个角度看，DRA 的调度的效率和成功率都会高一些。

## 一些选型的建议

综合以上的信息：DRA 在模型无法占满单个 Node 的情况下会更加有用一点儿，如果模型本身就要把 Node 上的 GPU 全部占满，那意义就不大了。

另外 DRA 需要高版本的 K8s 的支持，而很多公司其实因为 K8s 版本升级的困难的问题，而锁死在某一个版本上了，估计想用起来也会比较困难。

## 写在最后

AI 时代，了解一项技术也变得简单了很多，比如，我是在 AICon 深圳上提到 DRA 的机制的，回来之后就让 Codex 帮我生成了能够在我本地的 Mac 上跑起来的 Hands-On 的教程，我按照教程一步步走，半个小时左右就把 DRA 的大概的机制搞明白了，并且跑通了一个 Demo。

AI 让学校的门槛前所未有地低。
