# 上游引用与版本

## v0.3 移植登记（AGPL-3.0-only）

阿里云盘：`src/core/nexus/cloud/aliyun-adapter.ts` 移植固定 OpenList v4.2.9 / `0497ee853853eff5fc0ada9f21684a990887de83` 的 Open、Share 两个驱动（下文所有摘要均重新下载核对一致）。保留 Open `getDriveInfo/list/getDownloadUrl`、14400 秒请求值、分享 `get_share_token/adrive/v3/file/list/get_share_link_download_url`、600 秒请求值、X-Canary、x-share-token、分享下载 Referer 与独立分享 token 刷新。官方 OAuth 使用自有应用，回调匹配地址和随机 state，仅读取权限；兼容在线刷新使用上游 `refresh_ui/server_use/driver_txt=alicloud_qr` GET 协议，必须按账号显式同意并填写 HTTPS 服务地址。默认不启用、不预填第三方地址、不自动回退；不移植打印令牌/响应的日志与无限重试。分享不伪装为游客下载，Open token 不交给分享接口或 CDN。`aliyun-contract.test.ts` 为构造回放；`cloud-login.test.ts` 覆盖 OAuth 回调隔离；未使用真实账号。

补充文件：`drivers/aliyundrive_share/types.go` SHA-256 `df4bfc060f5bf01214954186f7f811a076eaa66976b248b2e35908e8db7ea7fe`。官方应用授权可获得的权限，以及 `getSpaceInfo` 是否对应用开放，必须由用户实际应用验收；不可用时健康空间显示未知。

123：`pan123-adapter.ts` 移植 `Pan123Api.kt`、`Pan123Constants.kt`、`Pan123ResolveRepository.kt`；`pan123-auth.ts` 移植 `Pan123DeviceId.kt`、`Pan123LoginSupport.kt` 与 Api 的 makeSign/passwordLogin。保留登录主机、132 版本头、密码原值、稳定设备标识、CRC32 签名（UTC +16 小时、固定 web/3）、分享 android/39 头、匿名目录不传空 SharePwd、DownloadURL 包装解码及最多五跳小 JSON 跳转；JWT 不交给 CDN。扩展个人盘翻页，避免只读首 100 项。按实际源码分享免转存，未开放独立“保存到云盘”操作。账号密码仅用于单次官方交换，落盘仅系统加密 JWT 和设备标识。构造回放见 `pan123-contract.test.ts`，真实流量和付费限制尚待验收；没有自动付费或提速承诺。

| 本项目文件 | 固定 YunX Desktop 1.3.4 来源（下表快照） | 调整 |
|---|---|---|
| `src/core/nexus/cloud/pan115-adapter.ts` | `Pan115Api.kt`、`Pan115Constants.kt`、`Pan115ResolveRepository.kt` | 请求参数、UA、Referer、电脑端 RSA/XOR 和 CDN Cookie 保持；失败不自动转存，由用户显式选择；每任务唯一根目录，严格按名称/大小/可用哈希认领；只删除本任务持有的目录 |
| `src/core/nexus/cloud/pan115-crypto.ts` | `data/network/Pan115Crypto.kt` | 原协议公钥、表、117/128 字节分块与 XOR 顺序；Node BigInt 实现 |
| `src/main/nexus/cloud-login.ts`（115 分支） | `Pan115LoginScreen.kt`、`Pan115Constants.kt` | 隔离官方网页登录，检测 UID + SEID，无 Node / preload，关闭即清理登录会话 |
| `src/core/nexus/cloud/pan115-contract.test.ts` | 上述响应结构 | 构造回放；密钥和凭据只在运行时生成；未使用真实账号 |

115 的协议公钥和版本参数是公开协议常量，不是账号密钥。临时转存进入回收站，应用不替用户永久删除回收站内容。大文件网页直链被拒时明确提示权限限制，用户可在预检前改选转存。

P0 历史记录（2026-11-15）：三个本地参考目录全程只读；没有构建或安装参考项目，
没有登录任何平台账号，也没有移植 YunX、OpenList 或 MDM 代码。

| 来源 | 版本与固定依据 | 本次用途 |
|---|---|---|
| Motrix Turbo | 本地 `package.json` 2.4.1；原样导入提交 `e1e3ec1` | Windows 底座、便携模式、引擎接口、分层与构建规范 |
| YunX Desktop | 本地 `version.txt` 1.3.4（Beta=0） | 只读盘点百度、夸克、UC、115、123 的登录与取链路线 |
| MDM | 本地 `Cargo.toml` workspace.package.version 0.5.2 | 只核对定案的参考版本，P0 未借用实现 |
| aria2 | `scripts/engine.lock.json` 固定 `v1.37.0-motrix.24` | 换链与 SQLite 断点实测；阅读同 tag 的 RPC 实现 |
| OpenList | [v4.2.9](https://github.com/OpenListTeam/OpenList/tree/v4.2.9)，commit `0497ee853853eff5fc0ada9f21684a990887de83` | 阿里云盘 Open 及独立分享驱动；只读 |

本地参考快照没有凭空推断 Git 提交号；下表文件 SHA-256 用于精确定位所读版本。
路径分别相对于对应的上游仓库根目录，不是本机绝对路径。

## Motrix Turbo 2.4.1

原始复制的 3294 个文件逐一核对 SHA-256，与本地参考完全一致；排除依赖、
Git 元数据和构建产物。后续修改保留在当前源代码中。

| 上游文件 | SHA-256 |
|---|---|
| `package.json` | `8b34968b4cc8c4661a4df6575dee2282447275db1f6971d3da7c77c1b5180782` |
| `pnpm-workspace.yaml` | `fcc0ba999a1342c160557c862f71506b78134e041dbf846cbafdd5eefb896b6e` |
| `electron-builder.json` | `8077f1a8455a0f1aea058cca2f09d5d4d7c7122cc5a7b79a76bb99f03ef5afef` |
| `README.zh-CN.md` | `6df0302b28a717d481ae2e8f4f93befdcefaca42ba00934f8b578886a9b75ce5` |
| `AGENTS.md` | `929cc503e2686806d6f72cc7e88ef46480f2203cb886b2263c1f576ce1391985` |
| `CLAUDE.md` | `d101f23fe120744d650994a725b7233396ca8af87ce15317debc63d6d82c48f0` |
| `scripts/engine.lock.json` | `e46b36d00d8be13909825b040d13ce17eabe78f4073b49880acd791640b27462` |
| `scripts/builtins.lock.json` | `351f1a8cfb8737830e6e265e37f974b56e754d40352ce62dee8ab1326ad75e9e` |
| `scripts/builtins-signing.pub.pem` | `cf645f16d045882dcfed5da67c153f9aa44e6d928c99f97d57d72146b1b09ffe` |
| `scripts/check-boundaries.mjs` | `6814b14085c205b92447f497b65705474b4ca006189d35c66f3ba20ac3ccc096` |
| `scripts/ensure-native-abi.mjs` | `9d1d93b1f8b07665eee0f86b5defe924a3cbea73cd3cc2fd4b39d9cc7775b575` |
| `scripts/windows-artifact-names.mjs` | `664b651d6e810801b038c8d67484fa16e84cddf9942b02bbb355260ed729679e` |
| `docs/portable-mode.zh-CN.md` | `3eb5e998dd76edcd495f8efa0cc6af95dd1fd6214b3f0e6d7ffd9fb10b406808` |
| `src/core/engine/engine-adapter.ts` | `a8434853fde7da615a8c87d27c77a788ba6d423922b55fa4dc685c62aac4d336` |
| `src/core/engine/aria2/aria2-adapter.ts` | `c469f8f65b01f59d1caa550caffb02821d28a4f659df5234d726196b2f179d79` |
| `src/core/engine/aria2/aria2-rpc-client.ts` | `64f6b48d63a0c7b6aea11c6ca761b11394c8c1960f4b8901f7116c8f796f9fa0` |
| `src/core/engine/aria2/aria2-config-builder.ts` | `7169fdacee67610f92f15e44fbb8a5a45459b479716e2921af57d730f8e2f524` |
| `src/core/engine/engine-session-recovery.ts` | `61573a265f356ba9680b98f432b0df9022bc67c60f485780814ca7cf8a84f0c6` |
| `src/core/task/direct-replay-recipe.ts` | `0cd361b9fed619dfc9c46d2a96c25aa24f9d36137d8a6d09237072bc57996888` |
| `src/core/session/session-manager.ts` | `15c82d7fce5e227ce6e7e323d59414f14c79a42a31dc8d2b328f1f75c64cf3e6` |
| `src/core/session/motrix-database.ts` | `706a2dd29b2115819aa4c52a00c4943379aed3cab8bdad86438d95947f7f3666` |
| `src/main/platform/portable-profile.ts` | `2c05999c9b0ef809d2bcf583cc2132f37270912a2c092f0d369a57ad09526ce2` |
| `src/shared/config/native-messaging-extensions.json` | `91907023995a87fae104e38a12e4d3544fb08918a7661a9559d4f858f754663b` |
| `src/shared/external-urls.ts` | `f6aea832748295289a543bba700220bae891de7631a4c0422974230058b32ec0` |
| `src/shared/lib/log-redact.ts` | `471eaec6d75d48ca6781b80e74ba5bb933bdfa5fe70da9dcc334e956107bcde3` |
| `.claude/rules/architecture.md` | `b57ce691592907d136d9be25e2c07d776f88d886b90b2adb96b1b8743f7a4af9` |
| `.claude/rules/commit-and-quality.md` | `715655b0e4d7318c70c6d623d36a454be31e31a84bae5b2f58585b6b74c19c16` |
| `.claude/rules/electron-vite.md` | `514fb8e60877dae441240e48b20a9696ad4373dc5fe037e0ba914d70ff90b7a7` |
| `.claude/rules/plugins.md` | `a524ca4ad59baa42ad9be3127002fb16ed0e077e8c224b9fdc2a64e5fbc5fe73` |
| `.claude/rules/plugin-registry.md` | `294d5a1f7c868874df2cb4fa6cd9840fc8c5859cf742ab971cd16eed886d7b0c` |
| `.claude/rules/bridge.md` | `95fdb6bc6e349a2b89dec9aaed0d69acc2440077dfb734a79b81003a32ade314` |
| `.claude/rules/language-and-docs.md` | `d6c8f0c3eca9468ef111b4fa57f06ec659ff70c7b9f87a8ca6b6878a95db61ae` |

## YunX Desktop 1.3.4

源码实现与请求头说明见 [平台盘点](platform-status.md)。

| 上游文件 | SHA-256 |
|---|---|
| `version.txt` | `13949d913dfb68c501767168d23f5392bd92609d69fab59ac08400c85eb27b4f` |
| `README.md` | `3a7fad1433959bb066d860c3d454ef0d44c77056f93bf54dfd9d278fe239e8ee` |
| `docs/FEATURES.md` | `90ceb1854465ba45f43881949b9d2d4ba6fe62774ecf9f61880514b86f89b09d` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/ShareResolveRepository.kt` | `2acccd7b97056e7808f9ddab1a29d4991d3c5e12b6af0a725d5108ecb25b9fc9` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/TransferSpaceGuard.kt` | `ea776414235cf52d012a75a8059b62d371922b721b88cc65e0b697cf29a510c1` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/model/ShareModels.kt` | `face2c744520add85a268cc2eb90e26fc323f8d0c1ab85453231183fcd2dd934` |
| `desktop/src/main/kotlin/com/yunx/app/ui/login/CookieLoginContent.kt` | `14e595511da02442ede7e0a0869513797b3cc7daa429774bcf44be32a378a877` |
| `desktop/src/main/kotlin/com/yunx/app/ui/jcef/JcefLoginPane.kt` | `61ce19df9f30f58d7014ede69198163cb407dd4d8bd00a3ec064149cc637f1a0` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/BaiduApi.kt` | `45a972c0e78a90f128f7472fdf68ca2770349f736f8cdc212c19a9e0412183bd` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/BaiduConstants.kt` | `e82ec31e21d8b16c4dd9e34f5b63e1995b421112e8fe24050ca4e009bfe6cee8` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/BaiduResolveRepository.kt` | `dee8c0e5dd4fd74b9bc5fd06d2ecf39ea9dc8155bc9a1528a7c1570f21f423f3` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/BaiduAccountRepository.kt` | `1ce3d88b1bf8ce9b5aa85a8400b24dedd8a1beb3228cb3e41164bb98bb9a4a4f` |
| `desktop/src/main/kotlin/com/yunx/app/ui/login/BaiduLoginScreen.kt` | `f7480eccc826c737a0128118dabdaca37b9cb295098affd2e5b3dbab15211c91` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/QuarkApi.kt` | `e1d023437dbf36ceee724592550cde6d9277e953b502c34f44d2e9bc2b530d1f` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/QuarkConstants.kt` | `b1e41a5159ee7070f9616668ec409d04dce5428837840cb3bfafe23915727425` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/QuarkResolveRepository.kt` | `120e567212d85a5e3db8d026ac0d51c217f3366d057f7e8692666a38b53ff435` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/QuarkAccountRepository.kt` | `922ce91b57eb7aa9c8db45f22823b4663dd08122a037c54bdd97a31af5a964a7` |
| `desktop/src/main/kotlin/com/yunx/app/ui/login/QuarkLoginScreen.kt` | `5770bc31e5c8ebbc2e46a7bb108a25c63b4c95b5843bded4f05c290cdf634224` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/UCApi.kt` | `a69a246e9f63227e0a584cd2c203b0518c35f2f78d7a53746eb85d654cc091e1` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/UCConstants.kt` | `d5b31b78dc6f132a56c10d8851099366d55e1bf3999ace3b8fde002b6d87bd1b` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/UCResolveRepository.kt` | `31d34d5e76e6c2143cbfc6d1d4442a56862e08503c728af598c3a9b895cbb572` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/UCAccountRepository.kt` | `47f9ab9b1bd2a200ee74b472a7507c39939248c193f1607e3fed84c72d81c21e` |
| `desktop/src/main/kotlin/com/yunx/app/ui/login/UCLoginScreen.kt` | `1ff652e03de02623ce2d4017bd4ba9df5546fe31a622610437cae3668d5c32f9` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/Pan115Api.kt` | `ab1bfc7ca243a4f7906e946a7ce1e2d6a5b889ed1f5eeed18ed7dca612e96071` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/Pan115Constants.kt` | `ed6c353ddf9615b47c0cb34404b1e7d34d109273bc61adda0f664483cebd4cdc` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/Pan115ResolveRepository.kt` | `6016060c98ebc546e42076dadd0fafee0b490ae1c302486c68f1337c28858359` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/Pan115AccountRepository.kt` | `76c9a05ab0d05a49a7ab2cf6cbd2db5b3150a19b516a344ce60e98972b9dd83c` |
| `desktop/src/main/kotlin/com/yunx/app/ui/login/Pan115LoginScreen.kt` | `b8b1329a0e30cd35f3027d4b7457f8fa6d633e0cd6dc49858261e33951938579` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/Pan123Api.kt` | `94e666e65459512d078746456017e263a2a6f6a719dfcb8eb1ed14263f881fe7` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/Pan123Constants.kt` | `da159bb919058b890afff093422f8715a61d1490ba573fcd0590a69b29c395d9` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/Pan123ResolveRepository.kt` | `bfb3bc46318d8420813ab255f8132c8ab0d02c76ef9c9daf6dc13d668f868930` |
| `desktop/src/main/kotlin/com/yunx/app/data/repository/Pan123AccountRepository.kt` | `30c1fd5ad4a0315092002f1df1c19e71fca1c41a73fb5ceb646d33a046165ed3` |
| `desktop/src/main/kotlin/com/yunx/app/ui/login/Pan123LoginScreen.kt` | `df9bf60f82890c7eca110c1057921dcc033dc825108569a1944839f8b1f56555` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/QuarkCdn.kt` | `4e1dca6a5ace5fb7b7690bc3c0e759966cec52b14189c027079666e6954dae4c` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/QuarkApiException.kt` | `2a6ac09bddda4ce21e8773ed64ca003d19c8948552a3da7d1cdebb314bbf537a` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/BaiduApiException.kt` | `75b7bea6e6492e7f6705074523543f02a652e9ab67a96bfc2543d0ec171372b1` |
| `desktop/src/main/kotlin/com/yunx/app/data/network/Pan123LoginSupport.kt` | `1b6ff0cd7ddec3bd42e4c098516238a45af2069e9c0e8ed319a849f655ddd838` |

## MDM 0.5.2

| 上游文件 | SHA-256 |
|---|---|
| `Cargo.toml` | `0d1a720cd661fb995a1b6896c83a3be0688d592f9a23e1e9d8cac09e6213f642` |

## OpenList v4.2.9

公开源文件均固定在上述 commit；下载副本仅存放在开发目录的忽略输出中。

| 上游文件 | SHA-256 |
|---|---|
| `drivers/aliyundrive_open/meta.go` | `5531ae7c95d94727746d0c71ded5eb8e575fac3b0f51944d15be5518f079faf2` |
| `drivers/aliyundrive_open/util.go` | `13430f6be4587c7272820b092fedb0314939d226cb3a9c5186c9dde3288571ff` |
| `drivers/aliyundrive_open/driver.go` | `956521facc7189a5e06a363a878c15c547103a72778499afd2ec894d030c08eb` |
| `drivers/aliyundrive_open/types.go` | `6d5557b9346475920045a876c2b6e0d945a8372ba167cca389844d54ac7e2180` |
| `drivers/aliyundrive_share/meta.go` | `32210f7921daf54455f3e9d090cb6bce9a843a9dd5e4b5b8d587b2f7cf45d153` |
| `drivers/aliyundrive_share/util.go` | `61b0933f17105eda9382bfefdedb58397f0e8aad0cef8af1a59f377097bbd9ea` |
| `drivers/aliyundrive_share/driver.go` | `bf0b5cf314bc0090ee86f0033d1cd80db258938b95988d05398c7edf7f387419` |

## 配套引擎与内置插件

- [aria2 RPC 实现](https://github.com/motrixapp/aria2/blob/v1.37.0-motrix.24/src/RpcMethodImpl.cc) `src/RpcMethodImpl.cc` SHA-256：`ce67c7ea7f8b32e80ce64471465df9f6f048ee1280856e311878b85467ab46de`。
- Windows x64 aria2 ZIP SHA-256：`3305bc54c4b03da7d702848a189c8f40c85a23cce9c432e8ecf7c03d7b2dd11e`。
- EXE SHA-256：`8138d93127fb5885a8100480a260d8383559b598e7e3e6ceedbc1d9f5959c849`。
- 内置插件 `motrix.filename-template` 1.1.1，锁定归档 SHA-256：`3b88e4b79ae3a019f1efec08ccd69bf6f83088887f7c13205f1d58ea22bfc4da`。
- 内置插件 `motrix.url-resolver` 1.0.0，锁定归档 SHA-256：`308dfd0ce86332f43aeb6ee84fad36a37d71f8fb7ef1eb1b79a0e6beb58e4a9e`。

内置插件保留上游真实身份，由锁定公钥验证签名后随包分发。NexusDownload
没有创建 Motrix 官方签名、没有使用官方应用签名证书、没有发布到官方更新源。
P0 应用仅供个人使用，Windows EXE 未签名。

## 公开接口资料

- [aria2 RPC 手册](https://aria2.github.io/manual/en/html/aria2c.html)：changeUri、changeOption、暂停、移除与重新添加的协议含义；实际行为以配套分支实测为准。
- [阿里云盘开发者入口](https://www.alipan.com/developer)：后续确认 OAuth 应用授权与权限。
- [123 开发者入口](https://www.123pan.com/developer)、[115 开放平台](https://open.115.com/)、[百度开放平台](https://pan.baidu.com/union/document/entrance)：后续核对授权路线；P0 没有调用这些服务。

后续升级先对照文件版本和摘要，再做脱敏契约测试及真实账号验证。本次没有
把上游完整响应、Cookie、令牌、提取码或签名下载地址放进引用文档。

## v0.2 移植登记（AGPL-3.0）

| 本项目文件 | YunX Desktop 1.3.4 来源 | 许可证与调整 |
|---|---|---|
| `src/core/nexus/cloud/cloud-adapter.ts` | `data/repository/ShareResolveRepository.kt`、`data/network/model/ShareModels.kt` | AGPL-3.0-only；增加续链、能力与身份/大小核验；凭据隔离到宿主 |

来源文件均相对于 `desktop/src/main/kotlin/com/yunx/app/`，固定快照哈希见上表。移植文件保留来源和 SPDX 声明。真实账号尚待手动验收。

| 本项目文件 | YunX Desktop 1.3.4 来源 | 许可证与调整 |
|---|---|---|
| `src/core/nexus/cloud/quark-uc-adapter.ts` | `data/network/QuarkApi.kt`、`QuarkConstants.kt`、`UCApi.kt`、`UCConstants.kt`；对应 ResolveRepository | AGPL-3.0-only；保留参数/UA/Referer；夸克 URL 不改 host；游客 Cookie 仅绑定本次响应 |
| `src/core/nexus/cloud/baidu-adapter.ts` | `data/network/BaiduApi.kt`、`BaiduConstants.kt`、`data/repository/BaiduResolveRepository.kt` | AGPL-3.0-only；按要求取消 8888 自动重试、立即删除转存；拒绝根目录回退及加密字节候选 |
| `src/core/nexus/cloud/adapter-contract.test.ts` | 上述 API 的响应结构 | AGPL-3.0-only；构造回放，凭据运行时随机生成，不保存值 |

本轮保留上游 locatedownload 的固定协议参数；它们不是用户凭据。百度目录页从上游单页扩为同参数翻页，避免漏选 100 项后的文件。令牌、返回错误原文和签名 URL 均不进入报告。

| 本项目文件 | YunX Desktop 1.3.4 来源 | 许可证与调整 |
|---|---|---|
| `src/core/nexus/cloud/kouling.ts` | `data/network/XunleiKouling.kt`、`XunleiApi.kt`、`StarSeaApi.kt`、`StarSeaConstants.kt` | AGPL-3.0-only；先迅雷再星海；不分发上游内嵌服务密钥，星海使用本地加密的用户自有服务 key；默认不发送口令 |

UC 播放流移植 `UCApi.getPlayLink/playProject`，保持 resolutions/supports 与请求头，风险错误不做备用请求。原文件大小不一致直接中止，禁止用播放流掩盖大小不一致。只支持单文件播放地址另存“非原文件”；HLS 播放清单明确报不支持，未擅自扩展到 v0.3 视频流水线。

Pan115Crypto.kt SHA-256：`fa2a4c6f689474a69aa8088d2b1e6297f28e06826d83d08c1187524861152cc2`。

Pan123DeviceId.kt SHA-256：`2d065220b9771054148581b15d93336b4f197dae32929bb5568421bcff12adb0`。

会员健康仅读取 115 `user/info.data.is_vip`、123 `user/info.data.Vip` 的明确布尔或 0/1 值；缺失及其他值保持未知，待真实账号确认，不推断付费权益。

## v0.4 国内媒体移植（AGPL-3.0-only）

`src/core/nexus/media/domestic-parsers.ts` 翻译 YunX Desktop 1.3.4 `data/network/video/` 的 DouyinParser.kt、KuaishouParser.kt、WeiboParser.kt、XhsParser.kt、BilibiliParser.kt、AcFunParser.kt、PixivParser.kt；保留 API 字段、请求头和 AVC 优先、小红书原图回退、Live Photo 关联。原始目录只读。

| 来源文件 | SHA-256 |
|---|---|
| DouyinParser.kt | 24d82da169b8f04d417113538da679d36450c274abcb3b1f22e54be7fffc034c |
| KuaishouParser.kt | 040074408a2e2658d356d1cf83f6ddbc6f54d928b0561db74293f3db00a23117 |
| WeiboParser.kt | f0c10252a9564da2c52c79e4e96fd1d0fcc320c0885e85f7135df050192a2e83 |
| XhsParser.kt | e899284e1be261707926a2424410efc19aff1ba5ef01b98d390b968ce58a0ed0 |
| BilibiliParser.kt | 207a0c3145439a7edc208e788f0a8d50f98103c602fb69e10cbc26b819f24714 |
| AcFunParser.kt | 0c2db17bb1edbee8da2a574256fa4affdeca2c54a9805d3d6e589fd606adf0f3 |
| PixivParser.kt | b44c221d491399c43386b30632c7b233c7d2052b77e32ca506754b2d18875620 |

## v0.4 外部工具固定版本

完整 URL 与 SHA-256 见 src/shared/schemas/nexus-tools.ts。yt-dlp 2026.10.26（GitHub 官方 EXE，含 EJS）；gallery-dl 1.32.20（Codeberg 官方 EXE）；Deno 2.9.8（官方 GitHub ZIP）；7-Zip 26.06（官方 x64 MSI，只提取 7z.exe 与 7z.dll）；FFmpeg N-128915-g3d16b774d7（FFmpeg-Builds/FFmpeg-Builds LGPL 静态构建，2026-11-15 固定归档）。以上均按需下载，不打包。哈希来自固定 release asset digest / gallery-dl SHA256SUMS。

## v0.4 Live Photo
- `src/core/nexus/media/motion-photo-writer.ts` 翻译 YunX Desktop 1.3.4 `data/download/MotionPhotoWriter.kt` 的 JPEG/JFIF 插入点、XMP 容器目录、OPPO Exif 模板和视频尾部拼接。AGPL-3.0-only；原文件模板另署 flashlab/motion-live-photo。源路径只读。输出为 Android Motion Photo，iOS 配对 MOV 格式不在本轮范围。

## v0.5 115 离线下载
- 协议参考：ChenyangGao/p115client commit `ab2fd4d6115607fd6dac1238ebbfb074d3dea4d7`，MIT；`p115client/client.py` 的 `_clouddownload_web_request`、`clouddownload_task_add_url`（显式 web 模式）、`clouddownload_task_list`、`clouddownload_task_del`、`clouddownload_quota_info`。源码 SHA-256 `59f86f235cb01622edf5ee1acb69b2d5cb4d31c87a110377f09b4eaf466d6906`。
- 本地 YunX Desktop 1.3.4 `Pan115Api.kt`/`Pan115ResolveRepository.kt` 继续提供列目录、下载地址、临时目录清理流程，AGPL-3.0-only（原固定版本与哈希不变）。新增 `pan115-offline-adapter.ts` 的组合实现保留 AGPL 声明；不移植上游凭据或日志。
- 使用 clouddownload.115.com 的 HTTPS `/web/` 与 ac 表单；磁力与 HTTP 均提交到本作业独立目录；status=2 才列文件；按平台 SHA-1 校验；额度只显示明确 quota/total 数值。未注册、登录或使用真实账号。

## v1.0 补完
- 同一 YunX 1.3.4 固定来源：DouyinParser.kt 159–212、320–585、705–772（匿名访客更新、SSR/XHR/作品图回退）；XhsParser.kt 106–205（双路径及登录墙）；BilibiliParser.kt 127–151（单文件回退）；WeiboParser.kt 90–145（视频组件）；KuaishouParser.kt 45–75（入口重定向）。沿用 AGPL-3.0-only，参考目录保持只读。
- Pixiv `/ugoira_meta` 的 ZIP 与 file/delay 公开结构；本地实现仅允许声明的普通图片帧，最多 10,000 帧、1 GiB 和 1 小时，超限停止，保留 ZIP。
- iOS 配对按 Apple MakerApple tag 17、QuickTime mdta content.identifier 和 mebx still-image-time 标准结构独立实现。用 ExifTool 13.63 和固定 FFprobe 检查相同 UUID、int8 时间样本及视频帧一致性；真实相册导入待设备验收。LimitPoint/LivePhoto 的公开样本只用于临时结构对照，未复制其 Swift 实现或分发样本。
