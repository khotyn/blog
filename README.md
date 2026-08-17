# 小径分叉的花园

这是 [khotyn.com/blog](https://khotyn.com/blog/) 的 Hugo 源码仓库。

## 本地预览

使用 Hugo `0.165.0`：

```bash
hugo server
```

浏览器打开 <http://localhost:1313/blog/>。

## 构建

```bash
hugo --gc --minify
```

生成结果位于 `public/`。该目录是构建产物，不提交到 Git；部署时应由 CI 重新生成。

站点当前使用内置在 `themes/hugo-vitae/` 中的 Vitae 主题，没有 Git submodule 依赖。主题同步自上游提交
`e853037cdc1ab7eed3973449c8f692193c11416f`，并包含适配 Hugo `0.165.0` 的模板修正。
