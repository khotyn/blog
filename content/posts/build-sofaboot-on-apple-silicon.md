---
title: "在 Apple M1 上构建 SOFABoot"
date: 2021-11-02T11:32:55+08:00
---
最近间接得到一个社区同学的反馈，我们的开源项目 [SOFABoot](https://github.com/sofastack/sofa-boot) 在 Apple M1 上构建测试不通过。刚好我最近换了 M1 芯片的 MacBook Pro，就在本地尝试构建测试了一下，在经过一个小时左右的尝试之后，最终将 SOFABoot 成功在 M1 上测试通过了，这里记录下遇到的几个问题，并且最终是怎么解决的。

### protoc 的 Apple Silicon 支持

因为 SOFARPC 项目依赖于了 gRPC，所以在 SOFABoot 集成 SOFARPC 的项目中，用到了 protoc，在 rpc-sofa-boot 这个子工程下面，有这样一段代码：

```xml
<configuration>
    <protocArtifact>com.google.protobuf:protoc:3.7.1:exe:${os.detected.classifier}</protocArtifact>
    <pluginId>grpc-java</pluginId>
    <pluginArtifact>io.grpc:protoc-gen-grpc-java:${grpc.version}:exe:${os.detected.classifier}</pluginArtifact>
    <outputDirectory>build/generated/source/proto/test/java</outputDirectory>
    <clearOutputDirectory>false</clearOutputDirectory>
    <protocPlugins>
        <protocPlugin>
            <id>sofa-grpc</id>
            <groupId>com.alipay.sofa</groupId>
            <artifactId>sofa-rpc-compiler</artifactId>
            <version>${sofa.rpc.compiler.version}</version>
            <mainClass>com.alipay.sofa.gen.triple.SofaTripleGenerator</mainClass>
        </protocPlugin>
    </protocPlugins>
</configuration>
```

这里用到的 protoc 的两个包都是有根据当前的 OS 的版本来的，在 M1 的机器上，OS 的版本是 `osx-aarch`，因此，就找不到对应的包了：

![Image](/blog/build-sofaboot-in-apple-silicon/apple-m1-image01.png)

看起来升级到最新的版本 protoc 或许可以，并且 `com.google.protobuf:protoc`这个包的最新版本是有 M1 的支持的，但是 `protoc-gen-grpc-java`这个包到现在依旧没有支持 M1。

最终，我通过在运行 mvn 命令的时候直接指定 `os.detected.classifier` 为 `osx-x86_64`来解决这个问题：`mvn test -Dos.detected.classifier=osx-x86_64`。

### Zulu 删除了一些方法导致 jmockit 运行出错

遇到的另外的一个问题是 SOFABoot 用了 jmockit 来 mock 一些测试用例，这些测试用例运行的时候遇到了下面的这个错误：

![Image](/blog/build-sofaboot-in-apple-silicon/apple-m1-image02.png)

这个错误光看错误信息比较难，我直接在 Google 上查了一下，发现有人在 jmockit 的 github 上提过一个 [issue](https://github.com/jmockit/jmockit1/issues/710)，看起来是 zulu jdk 在 backport jdk9 的一些特性的时候，删除了一些方法，导致问题。

看来 zulu jdk 是不能用了，刚好支持 Liberica 也有支持 M1 的 JDK8 的版本，我用 sdkman 换成这个 JDK 版本就可以了：

![Image.png](/blog/build-sofaboot-in-apple-silicon/apple-m1-image03.png)