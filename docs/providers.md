# 模型接入与验证范围

接口核对日期：2026-10-19。默认模型名可由环境变量替换；不把“高质量”解释为已经完成全面模型评测。

## 实现

- 文本 `POST /responses`：读取 output 中的 output_text，保留 usage；设置 store=false。可切换 `POST /chat/completions` 兼容接口。
- 图片 `POST /images/generations`：quality 由 IMAGE_QUALITY 配置（默认 GPT Image 2.5 为 max），返回 base64 图片；含角色/场景参考时使用 multipart `POST /images/edits`。默认最多四张参考图。
- 视频 OpenAI：multipart `POST /videos`，轮询 `GET /videos/{id}`，取回 `GET /videos/{id}/content`。有首帧时按目标尺寸居中裁切生成临时参考，不改变原素材。
- 视频 Seedance：`POST /contents/generations/tasks`，轮询同路径 `/{id}`，从 content.video_url 下载到服务器。
- 工作流：服务端排队 → worker 提交 → 记录远端 ID → 查询进度 → 原始素材入库 → 用户审核 → 绑定到镜头。
- 超时/失败不会自动重复提交可能已计费的生成；用户手动确认后可重新提交。已经拿到 ID 的视频任务在重启后继续查询。

## 官方来源

- [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI GPT-6 系列](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI 图片生成](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [OpenAI 视频创建](https://developers.openai.com/api/reference/resources/videos/methods/create)
- [OpenAI 视频指南及人脸参考限制](https://developers.openai.com/api/docs/guides/video-generation)
- [火山引擎视频任务接口](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)

火山引擎文档正文需要浏览器 JavaScript 才能读取，当前适配器依据官方公开 API 入口与字段实现；需部署者用已开通的具体模型完成一次真实联调。不同型号的参数/人脸输入权限可能不同。

## 测试范围

自动化测试使用模拟服务商响应验证请求结构、参考图提交、任务状态、资产入库、错误处理和幂等性；不使用用户密钥、不消耗真实额度。真实画质、延迟、模型权限与扣费无法用模拟测试证明。部署配置密钥后应先各做一次文本、图片和短视频测试。

第三方“兼容”接口不等于完全兼容：仅支持文档列出的协议，不宣称兼容所有中转站或所有视频厂商。
