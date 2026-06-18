# Post · App Icon（亮操作蓝）

当前定稿的「文件栈」图标，亮操作蓝底。

## 文件

- Post-master.svg —— 可编辑矢量母版（1024，含 squircle 底）
- Post-1024.png … Post-16.png —— 各尺寸位图（1024 / 512 / 256 / 128 / 64 / 32 / 16）

## 生成 macOS .icns（在你本机终端）

```bash
mkdir Post.iconset
sips -z 16 16     Post-1024.png --out Post.iconset/icon_16x16.png
sips -z 32 32     Post-1024.png --out Post.iconset/icon_16x16@2x.png
sips -z 32 32     Post-1024.png --out Post.iconset/icon_32x32.png
sips -z 64 64     Post-1024.png --out Post.iconset/icon_32x32@2x.png
sips -z 128 128   Post-1024.png --out Post.iconset/icon_128x128.png
sips -z 256 256   Post-1024.png --out Post.iconset/icon_128x128@2x.png
sips -z 256 256   Post-1024.png --out Post.iconset/icon_256x256.png
sips -z 512 512   Post-1024.png --out Post.iconset/icon_256x256@2x.png
sips -z 512 512   Post-1024.png --out Post.iconset/icon_512x512.png
cp                Post-1024.png        Post.iconset/icon_512x512@2x.png
iconutil -c icns Post.iconset
```

## 生成 Windows .ico

```bash
# 需要 ImageMagick
magick Post-256.png Post-128.png Post-64.png Post-32.png Post-16.png Post.ico
```

颜色：底色 #60a5fa → #2563eb（亮操作蓝同色相微渐变）；标签点 #e8a05a。
