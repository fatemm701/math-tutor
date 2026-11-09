# 部署说明（Docker）

当前生产形态：

- 镜像 `node:22-alpine`，单阶段构建，容器内以 `node`（uid **1000**）运行
- 容器监听 `3000`，宿主机发布 `3001` → `http://<服务器IP>:3001`
- 数据落在宿主机 `./data/db.json`，容器挂载为 `/app/data`
- 计算全在浏览器里，服务端只做静态页 + 账号/记录，内存占用约 60 MB（限制 256m）

> ⚠️ `db.json` 是单文件 JSON + 原子写，**没有文件锁**，只能跑一个实例。
> 不要 `docker compose up --scale 2`，也不要用两个容器挂同一个 data 目录。

## 一、首次部署

### 1.1 上传代码（在开发机上）

```bash
tar --exclude=node_modules --exclude=data --exclude=.git --exclude='*.tar.gz' -czf poly-drill.tar.gz .
scp poly-drill.tar.gz ubuntu@<服务器IP>:/tmp/
```

### 1.2 服务器上解包

```bash
sudo mkdir -p /opt/poly-drill
sudo chown "$USER":"$USER" /opt/poly-drill
cd /opt/poly-drill
tar -xzf /tmp/poly-drill.tar.gz && rm /tmp/poly-drill.tar.gz
```

### 1.3 数据目录权限（最容易踩的坑）

容器内是 uid 1000，宿主机目录必须让它可写，否则启动即报
`EACCES: permission denied, mkdir '/app/data'`。

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```

已经跑过旧版本、要保留数据时，把 `db.json` 放进 `data/` 再执行上面的 `chown`。

### 1.4 环境变量

```bash
cp .env.example .env
vi .env          # 至少填 TEACHER_INVITE
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST_PORT` | 3001 | 宿主机对外端口 |
| `TEACHER_INVITE` | 空 | 老师注册口令；**留空 = 谁都能注册成老师**，公网务必设置 |
| `COOKIE_SECURE` | 0 | 只有走 HTTPS 时设 1，否则 HTTP 下登录后会话会丢 |
| `TRUST_PROXY` | 0 | 只有放在 Nginx/Caddy 后面才设 1（否则登录限速可被伪造 `X-Forwarded-For` 绕过） |

### 1.5 启动与验证

```bash
docker compose up -d --build
docker compose ps                 # STATUS 应为 Up ... (healthy)
docker compose logs -f --tail=50
curl -s localhost:3001/api/health # {"success":true,"data":{"ok":true,"users":0,"attempts":0}}
```

浏览器打开 `http://<服务器IP>:3001`，用 `.env` 里的口令注册老师即可开始。

### 1.6 安全组

云厂商安全组要放行 `TCP:HOST_PORT`（例如 3001）的入站；服务器本机防火墙对 Docker
发布的端口无效（Docker 直接写 iptables 的 `DOCKER` 链，绕过 ufw），所以**用安全组控制**。

## 二、更新代码

### 2.1 当前方式：开发机打 tar → 上传 → 服务器解包

```bash
# 开发机（仓库根目录）：打包，排除依赖/数据/本地工具/已有压缩包
tar --exclude=node_modules --exclude=data --exclude=.git --exclude=tools \
    --exclude='*.tar.gz' --exclude='.vscode' -czf poly-drill.tar.gz .
scp poly-drill.tar.gz ubuntu@<服务器IP>:/tmp/

# 服务器：覆盖代码并重建（./data 是挂载卷，数据不受影响）
cd /opt/poly-drill
tar -xzf /tmp/poly-drill.tar.gz && rm /tmp/poly-drill.tar.gz
docker compose up -d --build
docker compose ps
```

- `tools/` 是**开发机专用**（本地临时隧道脚本），已同时写进 `.gitignore` 和 `.dockerignore`：
  不进仓库，也不进镜像和部署目录。
- 只改了 `.env` 时不需要 `--build`，`docker compose up -d` 即可让新环境变量生效。

### 2.2 以后：服务器直接 `git pull`（待开通）

服务器 SSH 进 `github.com:443`、`ssh.github.com:443`、`github.com:22` 都已实测可达
（2026-11-09 验证，DEPLOY.md 旧版本记的"TCP 不通"已过时）。只差一把 GitHub 认可的只读密钥。

开通步骤（一次性，约 1 分钟）：

```bash
# 1) 服务器上生成仓库专用只读密钥（私钥只留在服务器）
ssh-keygen -t ed25519 -C "poly-drill-deploy@server" -f ~/.ssh/poly-drill_deploy -N ""
cat ~/.ssh/poly-drill_deploy.pub

# 2) 浏览器：github.com/fatemm701/math_train → Settings → Deploy keys → Add deploy key
#    粘贴上一步的公钥。Allow write access 不必勾（只读就够 pull）

# 3) 服务器上写 ~/.ssh/config（走 443，与开发机一致）
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/poly-drill_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# 4) 验证
ssh -T git@github.com                              # Hi fatemm701/math_train! You've successfully authenticated...
git ls-remote git@github.com:fatemm701/math_train.git | head   # 能列出分支即通过
```

开通后，更新流程简化为：

```bash
cd /opt/poly-drill
git pull --ff-only
docker compose up -d --build
docker compose ps
```

**不设自动拉取**（没有 cron、没有 webhook）：代码只有在人执行 `git pull` 之后才上线。
想撤销授权时，在 GitHub 的 Deploy keys 里删掉那把 key 即可，服务器上的脚本不受影响。

## 三、回滚

```bash
cd /opt/poly-drill
docker tag poly-drill:latest poly-drill:rollback   # 出事前的镜像打个标签
# 换回旧代码（旧的 tar 包或 git checkout <旧提交>）后：
docker compose up -d --build
# 若只想用旧镜像：docker tag poly-drill:rollback poly-drill:latest && docker compose up -d
```

## 四、备份与恢复

数据库就是一个 JSON 文件，备份只需要复制：

```bash
cd /opt/poly-drill
mkdir -p data/backup
cp data/db.json "data/backup/db-$(date +%F).json"
find data/backup -name 'db-*.json' -mtime +14 -delete   # 只留 14 天
```

每天 3 点自动备份（`crontab -e`）：

```cron
0 3 * * * cd /opt/poly-drill && cp data/db.json "data/backup/db-$(date +\%F).json" && find data/backup -name 'db-*.json' -mtime +14 -delete
```

恢复：

```bash
cd /opt/poly-drill
docker compose down
cp data/backup/db-2026-11-08.json data/db.json
sudo chown 1000:1000 data/db.json
docker compose up -d
```

## 五、排错速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 容器起来就退出，日志 `EACCES: permission denied` | 宿主 `data/` 不是 uid 1000 可写 | `sudo chown -R 1000:1000 data` |
| `docker compose ps` 一直 `starting`/`unhealthy` | 启动失败或 db.json 损坏 | `docker compose logs --tail=100`；损坏则用备份替换 |
| 登录成功但下一次请求又变未登录 | 用了 HTTP 却设了 `COOKIE_SECURE=1` | 改回 `0` |
| 接反代后所有人被算成同一个 IP | 没设 `TRUST_PROXY=1` | 设 1 后 `docker compose up -d` |
| 本机 `curl localhost:3001` 通、公网打不开 | 云安全组没放行 | 加 `TCP:3001` 入站规则 |
| `bind: address already in use` | 宿主端口被占 | 改 `.env` 的 `HOST_PORT` |
| 页面能开但学生看不到最新代码 | 浏览器缓存 | `Ctrl + F5` 强刷（`vendor/` 是真长缓存，文件名变了才会重下） |
| 记录偶尔丢失 | 起了多个实例同时写 db.json | 只保留一个容器：`docker ps -a | grep poly-drill` |
| 开通 git 后 `Permission denied (publickey)` | 公钥没加到 Deploy keys / 加错了仓库 / `IdentityFile` 路径不对 | `ssh -vT git@github.com` 看实际用的是哪把 key；确认仓库是 `fatemm701/math_train`，且 `~/.ssh/config` 指向正确私钥 |
| 开通 git 后 `fatal: not a git repository` | 目录还是 tar 部署留下的普通目录 | 不要 `git pull`，改用上面的 tar 方式；要转成仓库需 `git init` + `fetch` + `checkout -f`，先备份 `data/` |
| 开通 git 后 `git pull` 报本地有改动会覆盖 | 以前 `tar` 覆盖过被跟踪文件（git 把它们当成"本地修改"） | `git checkout -- .` 丢弃过期修改后再 `git pull --ff-only`；`data/` 与 `.env` 不在仓库里，不会被动 |

## 六、加 HTTPS（可选）

服务器上已有 Nginx Proxy Manager（80/443）。要上 HTTPS 时：

1. NPM 里新建 Proxy Host：域名 → 转发到 `172.17.0.1:3001`（Docker 默认网桥的宿主地址）
2. 申请 Let's Encrypt 证书，勾选 Force SSL
3. `.env` 里设 `COOKIE_SECURE=1`、`TRUST_PROXY=1`，然后 `docker compose up -d`
4. 验证：登录后刷新页面仍然保持登录

## 七、常用命令

```bash
docker compose ps                      # 状态与健康
docker compose logs -f --tail=100      # 跟日志
docker compose restart                 # 重启（不改配置）
docker stats poly-drill                # 内存/CPU 实时占用
docker compose down                    # 停止并移除容器（data 保留）
docker image prune -f                  # 清理悬空镜像
```

## 八、当前实例记录（62.234.12.76）

| 项 | 值 |
|---|---|
| 系统 | Ubuntu（内核 6.8），Docker 27.5.1 / Compose v2.32.4 |
| 账号 | `ubuntu`（uid **1000**），sudo 免密 |
| 部署目录 | `/opt/poly-drill`，数据 `/opt/poly-drill/data/db.json` |
| 端口 | 宿主 **3001** → 容器 3000（宿主 3000 已被 `open-webui` 占用） |
| 老师注册口令 | `/opt/poly-drill/.env` 里的 `TEACHER_INVITE` |
| 对外地址 | `https://poly-drill.gyf-time.cn`（NPM → `172.17.0.1:3001`，Let's Encrypt） |
| 已有服务 | `nginx-proxy-manager`（80/443）、open-webui、sillytavern 等 |

公网只开 **80/443**（22 供 SSH），3001 不对公网开放，访问一律走域名 + HTTPS。

因为走 HTTPS，`.env` 里开了这两项：

```ini
COOKIE_SECURE=1     # 会话 Cookie 只走 HTTPS
TRUST_PROXY=1       # 信任 NPM 的 X-Forwarded-For，登录失败限速按真实 IP 计
```

改 `.env` 后执行 `docker compose up -d`（不用 `--build`），否则容器还是旧环境变量。
注意：`COOKIE_SECURE=1` 时若绕过 HTTPS 直接访问 `http://IP:3001`，会出现"登录成功但立刻掉登录"，属预期行为。

### 源码仓库

| 项 | 值 |
|---|---|
| 远端（私有） | `github.com/fatemm701/math_train`，分支 `main` |
| 协议 | SSH，且**必须走 443**：本机 22 端口被网络屏蔽，`~/.ssh/config` 里已配 `Host github.com → HostName ssh.github.com / Port 443` |
| 日常提交 | `git push`（首次 `git push -u origin main` 已建好 upstream） |

服务器侧目前**不用** `git pull`，发布仍是「本机打包 → `scp` → 服务器解包 → `docker compose up -d --build`」。

连通性已在 2026-11-09 实测：服务器到 `github.com:443`、`ssh.github.com:443`、`github.com:22` 的 TCP 握手全部成功，
`curl https://github.com/fatemm701/math_train.git/info/refs?service=git-upload-pack` 返回 `401`（私有仓库、网络正常）。
所以**不再需要代理**；唯一缺的是 GitHub 认可的密钥，按 §2.2 加一把只读 Deploy key 即可切换到 `git pull`。

无论哪种方式，**`data/`、`.env`、`tools/` 都不进仓库也不上传**，更新代码不会动线上数据。

