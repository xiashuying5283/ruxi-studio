# 部署运维

## 运行结构

- web：Gunicorn，两个进程 / 每进程四线程；HTTP 请求不等待模型长任务。
- worker：单独进程，SQLite 持久队列，文件锁防止同库多个 worker；每 3 秒查询视频任务。
- studio_data：数据库、WAL 与素材。应用容器使用非 root 用户 UID 10001。
- 仅回环地址开放应用端口，公网使用 Caddy 或现有 HTTPS 代理。
- 管理员密码与 Flask SECRET_KEY 保存在服务器 .env（0600），不上传仓库。修改密码需重启 web；建议同时轮换 SECRET_KEY 使已有会话失效。

## 观察运行

```bash
docker compose ps
docker compose logs --tail=100 web worker
curl --fail http://127.0.0.1:8080/healthz
```

登录限流默认按直接连接地址记录；反向代理后访问共用一个地址，错误登录会触发工作室整体暂时限流。不要随意信任外部提供的 X-Forwarded-For。

## 更新

```bash
git pull --ff-only
docker compose up -d --build
```

使用 Caddy 时后续命令同样加 `-f compose.yaml -f compose.https.yaml`，保持服务配置一致。

## 一致性备份

先停止写入。生成请求正在执行时应等它完成；worker 的 stop_grace_period 为 5 分钟。

```bash
mkdir -p backups
docker compose stop web worker
docker compose run --rm --no-deps --user 0 \
  -v "$PWD/backups:/backups" \
  -v "$PWD/deploy/backup.py:/app/backup.py:ro" \
  web python /app/backup.py
docker compose start web worker
```

备份文件包含项目、历史版本、原始素材和任务上下文，请妥善保管。保留 .env 的独立安全备份。

## 恢复

在同一 Compose 项目下停止 web/worker，使用临时容器把备份中的 data 内容恢复到数据卷，所有者设为 10001:10001，再启动服务。不要往运行中的 SQLite 文件覆盖数据。恢复有覆盖风险，应先保留现有卷备份。

项目 JSON 导入会建立新项目，保留文本与分镜，清除旧服务器素材 ID。ZIP 中原始素材需要重新上传绑定；不是整库恢复工具。

切换视频服务商前先等待已提交的视频任务完成；远端任务 ID 不能跨服务商查询。

## 模型任务排障

- 未配置：页面仍可编辑；.env 设置密钥后 force-recreate。
- HTTP 401/403：检查服务商密钥、区域和模型权限。
- HTTP 400：检查模型支持的画幅、时长、人脸/参考图限制。
- HTTP 429：检查余额、并发和额度。
- 下载域名不允许：只添加明确的服务商 CDN 后缀。
- 重启时未拿到远端 ID：任务标为失败且提示“提交结果未知”，先查服务商账单再手动重试。
- worker 停止：queued 任务保留数据库中，恢复 worker 后继续。

## 部署规模

面向单人、单机工作室。没有多租户隔离、分布式任务队列与外部对象存储。SQLite、文件和备份需要持久磁盘；生产机建议至少 2 核 / 2GB 内存，较大的 ZIP 导出需要额外临时磁盘空间。
