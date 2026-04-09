# VGO AI Local API

这是 `VGO CODE` 的本地样板后端服务，提供最小可用的：

- `GET /health`
- `GET /models`
- `POST /auth/register`
- `POST /auth/login`
- `POST /chat`

## 运行

```powershell
cd E:\VGO-CODE\server
npm start
```

默认监听：

```text
http://127.0.0.1:3210
```

## 说明

这是一个本地样板服务，目的是为桌面端提供稳定的接口形状，后续可以直接替换成真实 `VGO AI` 后端。
