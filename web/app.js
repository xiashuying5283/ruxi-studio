import {
  S,
  esc,
  id,
  api,
  toast,
  download,
  markDirty,
  save,
  episode,
  shots,
  shot,
  asset,
  imageURL,
  newShot,
  baseProject,
  templates,
  shotPrompt,
} from "./state.js";
import { icon } from "./icons.js";
import {
  button as b,
  field,
  empty,
  statusTag,
  projectsPage,
  overviewPage,
  scriptPage,
  entitiesPage,
  storyboardPage,
  assetsPage,
  jobsPage,
  settingsPage,
  deliveryPage,
} from "./pages.js";
const root = document.querySelector("#root"),
  modalRoot = document.querySelector("#modal-root");
const navs = [
  ["projects", "我的项目", "grid"],
  ["overview", "项目概览", "film"],
  ["script", "剧本创作", "script"],
  ["characters", "角色档案", "users"],
  ["scenes", "场景设定", "scene"],
  ["storyboard", "分镜工作台", "film"],
  ["assets", "素材库", "folder"],
  ["jobs", "生成任务", "tasks"],
  ["delivery", "审核与交付", "down"],
];
let polling,
  actionBusy = false,
  modalData = {},
  previewTimer = null,
  previewIndex = 0,
  previewPlaying = false;
function login() {
  clearInterval(polling);
  root.innerHTML = `<div class="login-shell"><section class="login-brand"><a class="wordmark"><img src="/static/mark.svg" alt=""><div><strong>入戏</strong><small>STUDIO</small></div></a><div><div class="eyebrow" style="color:var(--mint);margin-bottom:22px">THE NEXT SCENE IS YOURS.</div><h1>你想讲的故事，<br>值得被看见。</h1><p>从第一行剧本，到最后一个镜头。<br>属于你的 AI 短剧制作工作室。</p></div><span class="tiny muted">独立部署 · 私有素材 · 多模型创作</span></section><section class="login-form"><form id="login-form"><span class="eyebrow">WELCOME BACK</span><h2 style="margin-top:13px">进入你的工作室</h2><p>输入部署时设置的工作室密码。</p><div class="field"><label for="password">工作室密码</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="12" placeholder="至少 12 个字符"></div><div class="error" id="login-error" role="alert"></div><button class="primary" type="submit">解锁工作室 ${icon("arrow")}</button><p class="tiny" style="margin-top:24px">密码由服务器管理员配置。密钥和素材不会发送到本工作台以外的服务，除非你主动发起 AI 生成。</p></form></section></div>`;
}
async function load() {
  S.config = await api("/config");
  S.projects = (await api("/projects")).projects;
  let last;
  try {
    last = localStorage.getItem("ruxi-last-project");
  } catch {}
  if (last && S.projects.some((p) => p.id === last))
    await selectProject(last, false);
  render();
  clearInterval(polling);
  polling = setInterval(poll, 5000);
}
async function selectProject(pid, draw = true) {
  await save();
  const p = await api("/projects/" + pid);
  S.project = p;
  S.episodeId = p.episodes[0]?.id || "";
  S.shotId = "";
  S.assets = (await api("/projects/" + pid + "/assets")).assets;
  S.jobs = (await api("/projects/" + pid + "/jobs")).jobs;
  S.dirty = false;
  S.saveError = "";
  try {
    localStorage.setItem("ruxi-last-project", pid);
  } catch {}
  S.page = "overview";
  if (draw) render();
  const draft = sessionStorage.getItem("ruxi-draft-" + pid);
  if (draft) {
    toast("发现未保存草稿，可在顶部“恢复草稿”中找回。");
    document.querySelector("#draft-button")?.classList.remove("hide");
  }
}
function render() {
  if (!S.project && !["projects", "settings"].includes(S.page))
    S.page = "projects";
  const p = S.project;
  root.innerHTML = `<aside class="sidebar"><a class="wordmark" href="#" data-action="navigate" data-page="projects"><img src="/static/mark.svg" alt="入戏标志"><div><strong>入戏</strong><small>STUDIO</small></div></a><span class="workspace-label">工作室 / WORKSPACE</span><nav class="navgroup">${navs.map(([key, label, ico], i) => `${i === 1 ? '<div class="workspace-label">当前项目</div>' : ""}<button class="navbutton ${S.page === key ? "active" : ""}" data-action="navigate" data-page="${key}" ${key !== "projects" && !p ? "disabled" : ""} title="${label}">${icon(ico)}<span>${label}</span>${key === "jobs" && S.jobs.some((j) => ["queued", "running", "submitted"].includes(j.state)) ? `<span class="count">${S.jobs.filter((j) => ["queued", "running", "submitted"].includes(j.state)).length}</span>` : ""}</button>`).join("")}</nav><div class="navfooter"><button class="navbutton ${S.page === "settings" ? "active" : ""}" data-action="navigate" data-page="settings" title="模型与设置">${icon("settings")}<span>模型与设置</span></button><div class="owner row"><span class="avatar">导</span><div class="grow"><strong class="tiny">我的工作室</strong><p class="tiny">独立部署版</p></div>${b("logout", icon("logout"), "iconbtn ghost", 'aria-label="退出登录"')}</div></div></aside><main class="main"><header class="topbar"><div class="row">${b("menu", icon("menu"), "mobile-menu iconbtn ghost", 'aria-label="打开导航"')}<div class="breadcrumb"><span>工作室</span><span>/</span><span>${esc(navs.find((x) => x[0] === S.page)?.[1] || "模型与设置")}</span></div></div><div class="row">${p ? `<span class="saved" id="save-label">${S.saveError ? "保存失败 · 请导出草稿" : S.dirty ? "未保存" : "已保存到服务器"}</span>${b("recover-draft", "恢复草稿", "ghost tiny " + (sessionStorage.getItem("ruxi-draft-" + p.id) ? "" : "hide"), 'id="draft-button"')}<select class="project-select" id="project-select" aria-label="切换项目">${S.projects.map((x) => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select>${b("export-json", icon("down"), "iconbtn ghost", 'aria-label="导出项目草稿"')}` : `<span class="badge green"><span class="dot"></span> 私有工作室</span>`}</div></header>${
    p && !["projects", "settings"].includes(S.page)
      ? `<div class="page-tabs">${[
          ["overview", "项目"],
          ["script", "剧本"],
          ["characters", "角色"],
          ["scenes", "场景"],
          ["storyboard", "分镜"],
          ["assets", "素材"],
          ["jobs", "任务"],
        ]
          .map(([key, label]) =>
            b(
              "navigate",
              label,
              key === S.page ? "active" : "",
              `data-page="${key}"`,
            ),
          )
          .join("")}</div>`
      : ""
  }${{ projects: projectsPage, overview: overviewPage, script: scriptPage, characters: () => entitiesPage("characters"), scenes: () => entitiesPage("scenes"), storyboard: storyboardPage, assets: assetsPage, jobs: jobsPage, settings: settingsPage, delivery: deliveryPage }[S.page]()}</main>`;
}
function modal(title, content, { footer = "", wide = false } = {}) {
  stopPreview();
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${title}"><div class="modal-head"><h2>${title}</h2>${b("close-modal", icon("close"), "iconbtn ghost", 'aria-label="关闭对话框"')}</div><div class="modal-body">${content}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}</section></div>`;
  modalRoot.querySelector("input,textarea,select,button")?.focus();
}

function ask(message) {
  return new Promise((resolve) => {
    const layer = document.createElement("div");
    layer.className = "modal-backdrop confirm-backdrop";
    layer.innerHTML = `<section class="modal" role="alertdialog" aria-modal="true" aria-label="确认操作"><div class="modal-head"><h2>确认操作</h2></div><div class="modal-body"><p>${esc(message)}</p></div><div class="modal-footer"><button data-confirm="no">取消</button><button class="primary" data-confirm="yes">继续</button></div></section>`;
    document.body.append(layer);
    layer.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-confirm]");
      if (btn) {
        layer.remove();
        resolve(btn.dataset.confirm === "yes");
      }
    });
    layer.querySelector("button").focus();
  });
}

function closeModal() {
  stopPreview();
  modalRoot.innerHTML = "";
  modalData = {};
}
const f = (name, label, value = "", opts = {}) =>
  field(label, name, value, opts).replaceAll("data-bind=", "data-form=");
const get = (name) =>
  modalRoot.querySelector(`[data-form="${name}"]`)?.value || "";
function projectModal(templateId = "blank", editing = false) {
  const t = templates.find((t) => t.id === templateId) || templates[0],
    p = editing
      ? S.project
      : {
          ...baseProject(),
          ...t,
          title: t.id === "blank" ? "" : t.title.split(" · ")[1],
        };
  modalData = { editing, templateId };
  modal(
    editing ? "项目设定" : "新建短剧项目",
    `${editing ? "" : `<label>选择一个创作起点</label><div class="template-grid">${templates.map((x) => b("choose-template", `<strong>${x.title}</strong><small>${x.subtitle}</small>`, "template-option " + (x.id === t.id ? "active" : ""), `data-template="${x.id}"`)).join("")}</div>`}${f("title", "项目名称", p.title)}<div class="fields2">${f("genre", "题材", p.genre, { options: S.config.genres })}${f("style", "视觉风格", p.style, { options: S.config.styles })}${f("ratio", "画幅", p.ratio, { options: ["9:16", "16:9", "1:1"] })}${f("budget", "项目预算 / 元", p.budget, { type: "number" })}</div>${f("logline", "一句话故事", p.logline, { multi: true })}${f("setting", "时代、世界与视觉设定", p.setting || "", { multi: true })}${editing ? f("notes", "创作备注与待核验事项", p.notes, { multi: true }) : '<div class="notice">模板只提供原创故事起点，不调用模型、不产生费用。内容可以全部修改。</div>'}`,
    {
      wide: true,
      footer:
        b("close-modal", "取消", "ghost") +
        b("save-project", editing ? "保存设定" : "创建项目", "primary"),
    },
  );
  modalData = { editing, templateId };
}
function entityModal(type, entityId = "") {
  const isChar = type === "characters";
  let e = S.project[type].find((x) => x.id === entityId) || {
    id: id(),
    name: "",
    role: "",
    appearance: "",
    costume: "",
    motivation: "",
    voice: "",
    description: "",
    lighting: "",
    referenceId: "",
  };
  modal(
    title(type, entityId),
    `${f("name", isChar ? "角色姓名 / 称呼" : "场景名称", e.name)}${isChar ? f("role", "人物定位", e.role) + f("appearance", "年龄、面容与体态", e.appearance, { multi: true }) + f("costume", "服装、配饰与固定道具", e.costume, { multi: true }) + f("motivation", "目标与人物动机", e.motivation, { multi: true }) + f("voice", "声音与表演提示", e.voice) : f("description", "空间、陈设与环境", e.description, { multi: true }) + f("lighting", "光线、色彩与气氛", e.lighting, { multi: true })}${f("referenceId", "视觉参考", e.referenceId, { options: [{ value: "", label: "暂不绑定" }, ...S.assets.filter((a) => a.mime.startsWith("image/")).map((a) => ({ value: a.id, label: a.name }))] })}<div class="notice">参考图可在素材库上传，也可先在分镜工作台生成后绑定。角色和场景的文字设定会用于构建镜头提示词。</div>`,
    {
      footer:
        (entityId ? b("delete-entity", "删除", "ghost danger") : "") +
        b("close-modal", "取消", "ghost") +
        b("save-entity", "保存档案", "primary"),
    },
  );
  modalData = { type, entityId, entity: e };
}
function title(type, entityId) {
  return (
    (entityId ? "编辑" : "新建") +
    (type === "characters" ? "角色档案" : "场景设定")
  );
}
function setBinding(path, value) {
  if (!S.project) return;
  const [kind, key] = path.split(".");
  let target =
    kind === "shot"
      ? shot()
      : kind === "episode"
        ? episode()
        : kind === "project"
          ? S.project
          : null;
  if (!target || !(key in target)) return;
  if (typeof target[key] === "number") {
    value = Number(value);
    if (!Number.isFinite(value)) return;
  }
  target[key] = value;
  markDirty();
  if (path === "episode.script") {
    let count = document.querySelector("#word-count");
    if (count) count.textContent = value.length + " 字符";
  }
}
async function poll() {
  if (!S.project || document.hidden) return;
  try {
    const pid = S.project.id;
    const next = (await api("/projects/" + pid + "/jobs")).jobs;
    if (S.project?.id !== pid) return;
    let changed = JSON.stringify(next) !== JSON.stringify(S.jobs);
    if (changed) {
      const completed = next.filter(
        (j) =>
          j.state === "completed" &&
          !S.jobs.some((old) => old.id === j.id && old.state === "completed"),
      );
      S.jobs = next;
      if (completed.length) {
        S.assets = (await api("/projects/" + pid + "/assets")).assets;
        toast(
          "有 " + completed.length + " 个任务完成，可在生成任务中审核结果。",
        );
      }
      if (S.page === "jobs" && !modalRoot.innerHTML) render();
    }
  } catch (e) {
    if (e.status === 401) {
      toast("登录已过期，请重新登录。未保存草稿仍可恢复。");
      login();
    }
  }
}
function bindAsset(target, filter = "image") {
  const list = S.assets.filter((a) => a.mime.startsWith(filter + "/"));
  modal(
    "绑定素材",
    `<p class="tiny muted" style="margin-bottom:20px">选择本项目素材。原素材保留，可随时更换。</p><div class="assets-grid">${list.map((a) => `<button class="panel asset-card" data-action="pick-asset" data-id="${a.id}"><div class="asset-preview">${filter === "image" ? `<img src="${a.url}" alt="${esc(a.name)}">` : icon("video")}</div><div class="pad"><h3>${esc(a.name)}</h3></div></button>`).join("") || empty("还没有可选素材", "先上传素材或发起一次生成。", "", "")}</div>`,
    { wide: true, footer: b("close-modal", "关闭") },
  );
  modalData = { target };
}
async function uploadAsset(target = "") {
  let el = document.querySelector("#file-input");
  el.accept = "image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/wav";
  el.value = "";
  el.onchange = async () => {
    const file = el.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) return toast("文件超过 100MB 限制");
    const pid = S.project.id;
    const shotId = shot()?.id;
    const form = new FormData();
    form.append("file", file);
    toast("正在上传素材…");
    try {
      const a = await api("/projects/" + pid + "/assets", {
        method: "POST",
        form,
      });
      if (S.project?.id !== pid) return;
      S.assets.unshift(a);
      if (target && shotId === shot()?.id) {
        const key = target.split(".")[1];
        if (
          (key === "imageId" && !a.mime.startsWith("image/")) ||
          (key === "videoId" && !a.mime.startsWith("video/"))
        )
          toast("已上传，但素材类型与镜头位置不符，请在素材库使用。");
        else {
          setBinding(target, a.id);
          await save();
        }
      }
      render();
      toast("素材已保存到服务器");
    } catch (e) {
      toast(e.message);
    }
  };
  el.click();
}
function jobConfirmation(
  kind,
  prompt,
  { shotId = "", episodeId = "", referenceIds = [], duration = 4 } = {},
) {
  const mode = ["script", "shotlist"].includes(kind) ? "text" : kind,
    c = S.config.providers[mode];
  if (!c.configured) {
    toast("请先在服务器 .env 中配置模型密钥");
    return;
  }
  modal(
    "确认生成任务",
    `<div class="row between"><h3>${{ script: "剧本创作", shotlist: "分镜拆解", image: "图片生成", video: "视频生成" }[kind]}</h3><span class="badge green">${esc(c.model)}</span></div><div class="notice warning">本次会把生成要求、项目设定及选中的参考素材发送给已配置的服务商，并产生 API 费用。费用以服务商账单为准。</div><label>本次生成要求</label><div class="ai-result">${esc(prompt)}</div><p class="tiny muted" style="margin-top:15px">参考图片 ${referenceIds.length} 张${kind === "video" ? " · 时长 " + duration + " 秒" : ""}。结果保存为候选，不覆盖已有作品。</p>`,
    {
      wide: true,
      footer:
        b("close-modal", "取消", "ghost") +
        b("submit-job", icon("spark") + " 确认提交", "primary"),
    },
  );
  modalData = {
    request: {
      kind,
      prompt,
      shotId,
      episodeId,
      referenceIds,
      duration,
      idempotencyKey: id(),
    },
  };
}
async function submitJob() {
  const req = modalData.request;
  if (!req) return;
  await save();
  const j = await api("/projects/" + S.project.id + "/jobs", {
    method: "POST",
    body: req,
  });
  S.jobs.unshift(j);
  closeModal();
  toast("任务已进入队列，可以继续创作。");
  if (S.page === "jobs") render();
}
function showJob(jid) {
  const j = S.jobs.find((j) => j.id === jid);
  if (!j) return;
  const r = j.result || {};
  let content = r.asset
    ? r.asset.mime.startsWith("image/")
      ? `<img class="job-result-image" src="${r.asset.url}" alt="生成图片候选">`
      : `<video class="job-result-image" src="${r.asset.url}" controls playsinline></video>`
    : `<div class="ai-result">${esc(r.text || "没有可显示的文本")}</div>`;
  if (r.parseError)
    content += '<div class="notice warning">' + esc(r.parseError) + "</div>";
  content += `<div class="divider"></div><p class="tiny muted">生成记录 ${j.id.slice(0, 8)} · ${esc(j.request.model)}。采用结果后仍可编辑。</p>`;
  modal(
    "生成结果 · " +
      { script: "剧本", shotlist: "分镜", image: "图片", video: "视频" }[
        j.kind
      ],
    content,
    {
      wide: true,
      footer:
        b("copy-job", "复制文本", "ghost") +
        b("close-modal", "关闭", "ghost") +
        b(
          "apply-job",
          r.asset
            ? "绑定到目标镜头"
            : j.kind === "shotlist"
              ? "追加到目标分集"
              : "采用为分集剧本",
          "primary",
        ),
    },
  );
  modalData = { jobId: jid };
}
async function applyJob() {
  let j = S.jobs.find((x) => x.id === modalData.jobId);
  if (!j) return;
  let p = S.project;
  if (j.kind === "script") {
    let e = p.episodes.find((x) => x.id === j.request.episodeId);
    if (!e) throw Error("原目标分集已不存在，请复制文本后手动采用");
    if (
      !(await ask(
        "将以生成结果替换目标分集的当前剧本，现有内容可在历史版本中找回。继续？",
      ))
    )
      return;
    e.script = j.result.text;
  } else if (j.kind === "shotlist") {
    let e = p.episodes.find((x) => x.id === j.request.episodeId);
    if (!e) throw Error("目标分集已不存在");
    if (!j.result.shots)
      throw Error("结果不是结构化分镜，请复制文本后手动整理");
    p.shots.push(
      ...j.result.shots.map((x) => ({
        ...newShot(e.id),
        ...x,
        id: id(),
        episodeId: e.id,
      })),
    );
    S.episodeId = e.id;
    S.shotId = p.shots.at(-j.result.shots.length).id;
  } else {
    let s = p.shots.find((x) => x.id === j.request.shotId);
    if (!s) throw Error("目标镜头已不存在，结果仍在素材库中，可手动绑定");
    s[j.kind === "image" ? "imageId" : "videoId"] = j.result.asset.id;
    s.status = "待审核";
  }
  markDirty();
  await save();
  closeModal();
  render();
  toast("已采用生成结果");
}
function markdown() {
  const p = S.project;
  return `# ${p.title}\n\n${p.logline}\n\n${p.genre}｜${p.style}｜${p.ratio}\n\n## 世界与设定\n${p.setting}\n\n## 角色\n${p.characters.map((c) => `### ${c.name}\n${c.appearance}\n${c.costume}\n${c.motivation}`).join("\n\n")}\n\n${p.episodes
    .map(
      (e) =>
        `## ${e.title}\n\n${e.script}\n\n${p.shots
          .filter((s) => s.episodeId === e.id)
          .map(
            (s, i) =>
              `### 镜头 ${i + 1} · ${s.title} · ${s.duration}s\n画面：${s.action}\n对白：${s.dialogue}\n声音：${s.sound}\n镜头：${s.camera}\n提示词：${s.prompt}\n连续性：${s.continuity}`,
          )
          .join("\n\n")}`,
    )
    .join("\n\n")}\n\n## 创作备注\n${p.notes}`;
}
function srt() {
  let cursor = 0;
  function timestamp(n) {
    return new Date(n * 1000).toISOString().slice(11, 23).replace(".", ",");
  }
  let i = 0;
  return shots()
    .map((s) => {
      let start = cursor;
      cursor += s.duration;
      return s.dialogue
        ? `${++i}\n${timestamp(start)} --> ${timestamp(cursor)}\n${s.dialogue}\n`
        : "";
    })
    .filter(Boolean)
    .join("\n");
}
function stopPreview() {
  clearTimeout(previewTimer);
  previewPlaying = false;
}
function preview() {
  if (!shots().length) return toast("请先添加镜头");
  previewIndex = 0;
  modal("分集顺序预览", '<div id="preview-body"></div>', { wide: true });
  drawPreview();
}
function drawPreview() {
  const ss = shots(),
    s = ss[previewIndex];
  let el = document.querySelector("#preview-body");
  if (!el || !s) return;
  const a = asset(s.videoId) || asset(s.imageId);
  el.innerHTML = `<div class="stage-viewport">${a ? (a.mime.startsWith("video/") ? `<video id="preview-video" controls playsinline src="${a.url}"></video>` : `<img src="${a.url}" alt="${esc(s.title)}">`) : `<div class="stage-empty"><span class="mono">SHOT ${previewIndex + 1}</span><p>${esc(s.action || s.title)}</p><small>此镜头尚未绑定素材</small></div>`}</div><div class="row between" style="margin:15px 0"><span class="mono">${previewIndex + 1} / ${ss.length} · ${s.duration}s</span><div class="preview-controls">${b("preview-prev", "上一镜", "ghost")}${b("preview-play", icon(previewPlaying ? "pause" : "play"), "primary", `aria-label="${previewPlaying ? "暂停" : "播放"}"`)}${b("preview-next", "下一镜", "ghost")}</div></div><p>${esc(s.dialogue)}</p><p class="tiny muted" style="margin-top:12px">按镜头计划时长顺序预览，不含转场与混音。最终剪辑请在剪辑软件中完成。</p>`;
  if (previewPlaying) {
    el.querySelector("video")
      ?.play()
      .catch(() => {});
    previewTimer = setTimeout(() => {
      if (previewIndex < ss.length - 1) {
        previewIndex++;
        drawPreview();
      } else {
        stopPreview();
        drawPreview();
      }
    }, s.duration * 1000);
  }
}
const actions = {
  navigate: async (el) => {
    await save();
    S.page = el.dataset.page || "storyboard";
    render();
  },
  menu: () => document.querySelector(".sidebar").classList.toggle("open"),
  logout: async () => {
    await save();
    await api("/logout", { method: "POST", body: {} });
    S.project = null;
    S.csrf = (await api("/session")).csrf;
    login();
  },
  "new-project": (el) => projectModal(el.dataset.template || "blank"),
  "choose-template": (el) => projectModal(el.dataset.template),
  "edit-project": () => projectModal("blank", true),
  "save-project": async () => {
    const editing = modalData.editing;
    const values = {
      title: get("title").trim(),
      genre: get("genre"),
      style: get("style"),
      ratio: get("ratio"),
      budget: Number(get("budget")),
      logline: get("logline"),
      setting: get("setting"),
      notes: editing ? get("notes") : "",
    };
    if (!values.title) throw Error("请输入项目名称");
    if (editing) {
      Object.assign(S.project, values);
      markDirty();
      await save();
      closeModal();
      render();
    } else {
      const p = await api("/projects", {
        method: "POST",
        body: { ...baseProject(), ...values },
      });
      S.projects.unshift(p);
      closeModal();
      await selectProject(p.id);
    }
  },
  "open-project": (el) => selectProject(el.dataset.id),
  "close-modal": closeModal,
  "new-episode": () => {
    modal(
      "添加分集",
      f(
        "title",
        "分集名称",
        `第 ${String(S.project.episodes.length + 1).padStart(2, "0")} 集`,
      ) + f("synopsis", "分集梗概", "", { multi: true }),
      {
        footer:
          b("close-modal", "取消", "ghost") +
          b("save-episode", "创建分集", "primary"),
      },
    );
  },
  "save-episode": async () => {
    const title = get("title").trim();
    if (!title) throw Error("请输入分集名称");
    const e = { id: id(), title, synopsis: get("synopsis"), script: "" };
    S.project.episodes.push(e);
    S.episodeId = e.id;
    S.shotId = "";
    markDirty();
    await save();
    closeModal();
    S.page = "script";
    render();
  },
  "open-episode": async (el) => {
    await save();
    S.episodeId = el.dataset.id;
    S.shotId = "";
    S.page = "script";
    render();
  },
  "edit-entity": (el) => entityModal(el.dataset.type || S.page, el.dataset.id),
  "save-entity": async () => {
    const { type, entityId, entity: e } = modalData;
    let keys =
      type === "characters"
        ? [
            "name",
            "role",
            "appearance",
            "costume",
            "motivation",
            "voice",
            "referenceId",
          ]
        : ["name", "description", "lighting", "referenceId"];
    let result = { id: e.id };
    for (const key of keys) result[key] = get(key);
    if (!result.name.trim()) throw Error("请输入名称");
    let index = S.project[type].findIndex((x) => x.id === entityId);
    if (index >= 0) S.project[type][index] = result;
    else S.project[type].push(result);
    markDirty();
    await save();
    closeModal();
    render();
  },
  "delete-entity": async () => {
    const { type, entityId } = modalData;
    if (
      !(await ask("删除档案并解除相关镜头引用？服务器历史版本仍会保留记录。"))
    )
      return;
    S.project[type] = S.project[type].filter((x) => x.id !== entityId);
    for (const s of S.project.shots) {
      if (type === "characters")
        s.characterIds = s.characterIds.filter((x) => x !== entityId);
      else if (s.sceneId === entityId) s.sceneId = "";
    }
    markDirty();
    await save();
    closeModal();
    render();
  },
  "add-shot": async () => {
    if (!episode()) return toast("请先添加分集");
    const s = newShot(episode().id);
    s.title = "镜头 " + String(shots().length + 1).padStart(2, "0");
    S.project.shots.push(s);
    S.shotId = s.id;
    markDirty();
    await save();
    render();
  },
  "select-shot": async (el) => {
    await save();
    S.shotId = el.dataset.id;
    render();
  },
  "set-mode": async (el) => {
    await save();
    S.mode = el.dataset.mode;
    render();
  },
  "duplicate-shot": async () => {
    const s = shot();
    const copy = {
      ...structuredClone(s),
      id: id(),
      title: s.title + "（副本）",
      imageId: "",
      videoId: "",
      status: "待制作",
      cost: 0,
    };
    let index = S.project.shots.indexOf(s);
    S.project.shots.splice(index + 1, 0, copy);
    S.shotId = copy.id;
    markDirty();
    await save();
    render();
  },
  "delete-shot": async () => {
    if (
      !(await ask("删除此镜头？原始素材会保留在素材库，历史版本可以恢复镜头。"))
    )
      return;
    S.project.shots = S.project.shots.filter((s) => s.id !== shot().id);
    S.shotId = "";
    markDirty();
    await save();
    render();
  },
  "move-shot": async () => {
    let list = S.project.shots,
      s = shot(),
      ss = shots(),
      n = ss.indexOf(s);
    if (n < 1) return;
    let i = list.indexOf(s),
      prev = list.indexOf(ss[n - 1]);
    [list[i], list[prev]] = [list[prev], list[i]];
    markDirty();
    await save();
    render();
  },
  "build-prompt": () => {
    setBinding("shot.prompt", shotPrompt(shot()));
    render();
    toast("已合并角色、场景和镜头设定");
  },
  "bind-asset": (el) => bindAsset(el.dataset.target, el.dataset.filter),
  "pick-asset": async (el) => {
    setBinding(modalData.target, el.dataset.id);
    await save();
    closeModal();
    render();
  },
  "upload-asset": () => uploadAsset(),
  "upload-for-shot": () =>
    uploadAsset("shot." + (S.mode === "video" ? "videoId" : "imageId")),
  "generate-script": async () => {
    await save();
    const intent = document.querySelector("#script-intent").value,
      extra = document.querySelector("#script-instruction").value,
      e = episode();
    const instruction = {
      draft: "请根据梗概起草本集完整剧本。",
      rewrite: "请重写以下剧本，增强人物动机与戏剧冲突，保持原有设定。",
      dialogue: "请润色以下剧本的对白，保持人物口吻与剧情信息。",
      review:
        "请审查以下剧本的逻辑、节奏、人物动机与连续性，输出具体问题与修订建议。",
    }[intent];
    jobConfirmation(
      "script",
      instruction +
        "\n本集梗概：" +
        e.synopsis +
        "\n已有剧本：" +
        e.script +
        "\n补充要求：" +
        extra,
      { episodeId: e.id },
    );
  },
  "generate-shotlist": async () => {
    await save();
    if (!episode().script.trim()) throw Error("先写剧本，再拆解分镜");
    jobConfirmation(
      "shotlist",
      "请将本集剧本拆解为可制作的分镜：\n" + episode().script,
      { episodeId: episode().id },
    );
  },
  "split-paragraphs": async () => {
    const parts = episode()
      .script.trim()
      .split(/\n\s*\n/)
      .filter(Boolean);
    if (!parts.length) throw Error("先写剧本，用空行分隔段落");
    if (!(await ask(`将按空行追加 ${parts.length} 个镜头，不调用 AI。继续？`)))
      return;
    S.project.shots.push(
      ...parts.map((action, i) => ({
        ...newShot(episode().id),
        title: "段落 " + (i + 1),
        action,
      })),
    );
    markDirty();
    await save();
    S.page = "storyboard";
    render();
  },
  "generate-media": async () => {
    await save();
    let s = shot(),
      prompt = s.prompt.trim() || shotPrompt(s);
    if (!s.action.trim() && !s.prompt.trim())
      throw Error("请先填写画面动作或提示词");
    const mode = S.mode;
    let references =
      mode === "video"
        ? s.imageId
          ? [s.imageId]
          : []
        : [
            ...S.project.characters
              .filter((c) => s.characterIds.includes(c.id))
              .map((c) => c.referenceId),
            S.project.scenes.find((x) => x.id === s.sceneId)?.referenceId,
          ].filter(Boolean);
    references = [...new Set(references)].slice(0, 4);
    jobConfirmation(
      mode,
      prompt + (s.negative ? "\n避免：" + s.negative : ""),
      {
        shotId: s.id,
        episodeId: s.episodeId,
        referenceIds: references,
        duration: s.duration,
      },
    );
  },
  "submit-job": submitJob,
  "job-result": (el) => showJob(el.dataset.id),
  "apply-job": applyJob,
  "copy-job": async () => {
    let j = S.jobs.find((x) => x.id === modalData.jobId);
    await navigator.clipboard.writeText(j.result.text || j.request.prompt);
    toast("已复制");
  },
  "refresh-jobs": async () => {
    S.jobs = (await api("/projects/" + S.project.id + "/jobs")).jobs;
    S.assets = (await api("/projects/" + S.project.id + "/assets")).assets;
    render();
  },
  "cancel-job": async (el) => {
    await api("/jobs/" + el.dataset.id + "/cancel", {
      method: "POST",
      body: {},
    });
    await actions["refresh-jobs"]();
  },
  "retry-job": (el) => {
    let j = S.jobs.find((x) => x.id === el.dataset.id);
    jobConfirmation(j.kind, j.request.prompt, j.request);
  },
  "export-json": () =>
    download(
      (S.project.title || "project") + ".json",
      JSON.stringify(S.project, null, 2),
    ),
  "export-markdown": () =>
    download(
      S.project.title + ".md",
      markdown(),
      "text/markdown;charset=utf-8",
    ),
  "export-srt": () => {
    if (!episode()) throw Error("先添加分集");
    download(episode().title + ".srt", srt(), "text/plain;charset=utf-8");
  },
  "export-package": async () => {
    await save();
    const a = document.createElement("a");
    a.href = "/api/projects/" + S.project.id + "/export";
    a.download = "ruxi-project.zip";
    a.click();
    toast("正在打包并下载素材，请稍候。");
  },
  "import-project": () => {
    const f = document.querySelector("#file-input");
    f.accept = ".json,application/json";
    f.value = "";
    f.onchange = async () => {
      try {
        const file = f.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) throw Error("JSON 超过 2MB");
        let p = JSON.parse(await file.text());
        if (!Array.isArray(p.episodes)) {
          const ep = {
            id: id(),
            title: "第 01 集",
            script: p.script || "",
            synopsis: p.premise || "",
          };
          p = {
            ...baseProject(),
            title: p.title || "导入项目",
            logline: p.premise || "",
            setting: p.era || "",
            episodes: [ep],
            characters: (p.characters || []).map((c) => ({
              id: id(),
              name: c.name || "角色",
              appearance: c.look || "",
              motivation: c.goal || "",
            })),
            shots: (p.shots || []).map((s) => ({
              ...newShot(ep.id),
              action: s.action || "",
              camera: s.camera || "",
              dialogue: s.audio || "",
              duration: Number(s.duration) || 4,
            })),
          };
        } else {
          p.shots = (p.shots || []).map((s) => ({
            ...s,
            imageId: "",
            videoId: "",
          }));
          p.characters = (p.characters || []).map((c) => ({
            ...c,
            referenceId: "",
          }));
          p.scenes = (p.scenes || []).map((c) => ({ ...c, referenceId: "" }));
        }
        const result = await api("/projects", { method: "POST", body: p });
        S.projects.unshift(result);
        await selectProject(result.id);
        toast("已导入文字档案；原素材请重新上传并绑定。");
      } catch (e) {
        toast(e.message || "导入失败");
      }
    };
    f.click();
  },
  versions: async () => {
    await save();
    let v = (await api("/projects/" + S.project.id + "/versions")).versions;
    modal(
      "项目历史版本",
      `<p class="tiny muted" style="margin-bottom:18px">最近 50 次保存。恢复会创建新的当前版本，不会删除历史。</p><div class="jobs-list">${v.map((x) => `<div class="row between"><span class="mono">版本 ${x.revision}</span><span class="tiny muted">${new Date(x.created_at).toLocaleString("zh-CN")}</span>${b("restore-version", "恢复", "", `data-revision="${x.revision}"`)}</div>`).join("") || "<p>还没有历史版本。</p>"}</div>`,
      { footer: b("close-modal", "关闭") },
    );
  },
  "restore-version": async (el) => {
    if (!(await ask("恢复该版本作为当前内容？现在的内容会保留为历史版本。")))
      return;
    await save();
    const old = await api(
      "/projects/" + S.project.id + "/versions/" + el.dataset.revision,
    );
    Object.assign(S.project, old);
    S.episodeId = S.project.episodes[0]?.id || "";
    S.shotId = "";
    markDirty();
    await save();
    closeModal();
    render();
    toast("历史版本已恢复");
  },
  "recover-draft": () => {
    let d = sessionStorage.getItem("ruxi-draft-" + S.project.id);
    if (!d) return toast("没有待恢复草稿");
    modal(
      "恢复未保存草稿",
      "<p>可以先下载草稿，避免丢失。如果服务器已有更新，建议下载后手动合并。</p>",
      {
        footer:
          b("download-draft", "下载草稿") +
          b("close-modal", "关闭", "ghost") +
          b("apply-draft", "恢复到当前编辑", "primary"),
      },
    );
  },
  "download-draft": () =>
    download(
      "未保存草稿.json",
      sessionStorage.getItem("ruxi-draft-" + S.project.id),
    ),
  "apply-draft": async () => {
    let d = JSON.parse(sessionStorage.getItem("ruxi-draft-" + S.project.id));
    if (d.revision !== S.project.revision)
      throw Error("草稿基于旧版本，请先下载草稿后手动合并");
    S.project = d;
    markDirty();
    await save();
    closeModal();
    render();
  },
  preview: preview,
  "preview-prev": () => {
    stopPreview();
    previewIndex = Math.max(0, previewIndex - 1);
    drawPreview();
  },
  "preview-next": () => {
    stopPreview();
    previewIndex = Math.min(shots().length - 1, previewIndex + 1);
    drawPreview();
  },
  "preview-play": () => {
    if (previewPlaying) stopPreview();
    else previewPlaying = true;
    drawPreview();
  },
  "toggle-shot-table": () => {
    modal(
      "当前分集 · 分镜总表",
      `<div class="table-wrap"><table><thead><tr><th>编号</th><th>名称</th><th>画面与动作</th><th>景别 / 运镜</th><th>时长</th><th>状态</th></tr></thead><tbody>${shots()
        .map(
          (s, i) =>
            `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.action)}</td><td>${esc(s.camera)}</td><td>${s.duration}s</td><td>${esc(s.status)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`,
      { wide: true, footer: b("close-modal", "关闭") },
    );
  },
};
document.addEventListener("click", async (e) => {
  let el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  if (actionBusy) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  actionBusy = true;
  el.disabled = true;
  try {
    await fn(el);
  } catch (err) {
    toast(err.message || "操作失败");
  } finally {
    el.disabled = false;
    actionBusy = false;
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.bind) setBinding(el.dataset.bind, el.value);
});
document.addEventListener("change", async (e) => {
  try {
    let el = e.target;
    if (el.dataset.bind) {
      setBinding(el.dataset.bind, el.value);
      return;
    }
    if (el.dataset.character) {
      const s = shot();
      if (!s) return;
      s.characterIds = el.checked
        ? [...new Set([...s.characterIds, el.dataset.character])]
        : s.characterIds.filter((x) => x !== el.dataset.character);
      markDirty();
      return;
    }
    if (el.id === "project-select") await selectProject(el.value);
    if (el.id === "episode-select") {
      await save();
      S.episodeId = el.value;
      S.shotId = "";
      render();
    }
    if (el.id === "asset-filter") {
      S.assetFilter = el.value;
      render();
    }
    if (el.id === "asset-search") {
      S.assetSearch = el.value;
      render();
    }
    if (el.id === "job-filter") {
      S.jobFilter = el.value;
      render();
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "login-form") return;
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    const result = await api("/login", {
      method: "POST",
      body: { password: document.querySelector("#password").value },
    });
    S.csrf = result.csrf;
    await load();
  } catch (err) {
    document.querySelector("#login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const confirmation = document.querySelector(
      '.confirm-backdrop [data-confirm="no"]',
    );
    if (confirmation) confirmation.click();
    else closeModal();
  }
  if (e.key === "Tab") {
    const dialog =
      document.querySelector(".confirm-backdrop .modal") ||
      modalRoot.querySelector(".modal");
    if (dialog) {
      const all = [
        ...dialog.querySelectorAll(
          "button:not([disabled]),input,textarea,select,a[href]",
        ),
      ].filter((x) => x.getClientRects().length);
      const first = all[0],
        last = all.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    save()
      .then(() => toast("已保存"))
      .catch((err) => toast(err.message));
  }
});
window.addEventListener("beforeunload", (e) => {
  if (S.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
(async () => {
  try {
    const session = await api("/session");
    S.csrf = session.csrf;
    if (session.authenticated) await load();
    else login();
  } catch (e) {
    root.innerHTML = `<div class="empty"><h2>工作室暂时无法连接</h2><p>${esc(e.message)}</p><button data-action="reload">刷新页面</button></div>`;
    actions.reload = () => location.reload();
  }
})();
