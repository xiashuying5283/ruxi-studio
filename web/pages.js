import {
  S,
  esc,
  id,
  fmtDate,
  episode,
  shots,
  shot,
  asset,
  imageURL,
  shotPrompt,
  templates,
} from "./state.js";
import { icon } from "./icons.js";
export const button = (action, label, cls = "", data = "") =>
  `<button class="${cls}" data-action="${action}" ${data}>${label}</button>`;
const b = button;
export function field(
  label,
  path,
  value,
  { type = "text", multi = false, options = null, help = "", rows = 0 } = {},
) {
  let inputId = "field-" + path.replaceAll(".", "-");
  return `<div class="field"><label for="${inputId}">${label}</label>${
    options
      ? `<select id="${inputId}" data-bind="${path}">${options
          .map((x) => {
            let v = typeof x === "string" ? x : x.value,
              t = typeof x === "string" ? x : x.label;
            return `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(t)}</option>`;
          })
          .join("")}</select>`
      : multi
        ? `<textarea id="${inputId}" data-bind="${path}" ${rows ? `rows="${rows}"` : ""}>${esc(value)}</textarea>`
        : `<input id="${inputId}" type="${type}" ${type === "number" ? 'min="0" step="any"' : ""} data-bind="${path}" value="${esc(value)}">`
  }${help ? `<small>${help}</small>` : ""}</div>`;
}
export function empty(title, description, action, label, ico = "film") {
  return `<div class="empty">${icon(ico)}<h3>${title}</h3><p>${description}</p>${action ? b(action, label, "primary") : ""}</div>`;
}
export function statusTag(state) {
  const green = ["completed", "已完成"],
    amber = ["running", "submitted", "queued", "制作中", "待审核"];
  const labels = {
    completed: "已完成",
    queued: "排队中",
    running: "生成中",
    submitted: "生成中",
    failed: "失败",
    cancelled: "已取消",
  };
  return `<span class="badge ${green.includes(state) ? "green" : amber.includes(state) ? "amber" : state === "failed" ? "red" : ""}"><span class="dot"></span>${labels[state] || esc(state)}</span>`;
}
const num = (n) => String(n).padStart(2, "0");
function metrics(items) {
  return `<div class="metrics">${items.map(([name, value, unit]) => `<div class="metric"><span>${name}</span><strong>${value}<small>${unit || ""}</small></strong></div>`).join("")}</div>`;
}
export function projectsPage() {
  let all = S.projects;
  return `<div class="page"><section class="welcome"><div><div class="label">YOUR STORIES. YOUR STUDIO.</div><h1>把一个想法，拍成一段故事。</h1><p>从剧本到分镜，从角色到画面。在同一个工作室里，完成你的下一部短剧。</p><div class="row">${b("new-project", icon("plus") + " 新建项目", "primary")}${b("import-project", icon("upload") + " 导入项目")}</div></div><div class="production-note"><span class="eyebrow">PRODUCTION WORKSPACE</span><strong>故事，由你掌镜。</strong><p>题材没有边界。悬疑、爱情、喜剧、科幻，或是尚未被命名的想象。</p><div class="row wrap" style="margin-top:17px">${["真人电影", "动画短剧", "原创故事"].map((x) => `<span class="badge">${x}</span>`).join("")}</div></div></section>${metrics(
    [
      ["进行中的项目", all.length, "部"],
      ["已编排镜头", all.reduce((n, p) => n + p.shots.length, 0), "个"],
      [
        "已完成镜头",
        all.reduce(
          (n, p) => n + p.shots.filter((s) => s.status === "已完成").length,
          0,
        ),
        "个",
      ],
      [
        "生成任务",
        S.jobs.filter((j) =>
          ["queued", "running", "submitted"].includes(j.state),
        ).length,
        "当前项目待处理",
      ],
    ],
  )}<div class="sectionhead"><div class="row"><h2>我的项目</h2><span class="badge">${all.length}</span></div><span class="muted tiny">最近更新优先</span></div><div class="project-grid">${all
    .map((p, i) => {
      let done = p.shots.filter((s) => s.status === "已完成").length,
        percent = p.shots.length
          ? Math.round((done / p.shots.length) * 100)
          : 0;
      return `<article class="panel project-card"><div class="project-cover cover-${i % 3}"><span class="cover-type">${esc(p.genre)} / ${esc(p.style)}</span><span class="cover-name">${esc(p.title.slice(0, 10))}</span><span class="cover-watermark">${num(i + 1)}</span></div><div class="project-info"><div class="row between"><h3>${esc(p.title)}</h3><span class="badge">${esc(p.ratio)}</span></div><p>${esc(p.logline || "故事还在酝酿，打开项目，写下第一场戏。")}</p><div class="progress" style="--progress:${percent}%"><div></div></div><div class="project-meta"><span>${p.episodes.length} 集 · ${p.shots.length} 镜头 · ${percent}% 完成</span><span>${fmtDate(p.updated_at)}</span></div><div class="row between" style="margin-top:17px"><span class="tiny muted">PROJECT ${num(i + 1)}</span>${b("open-project", "进入制作 " + icon("arrow"), "ghost", `data-id="${p.id}"`)}</div></div></article>`;
    })
    .join(
      "",
    )}<button class="new-project" data-action="new-project">${icon("plus")}<span>创建新的故事</span><span class="tiny">选择模板，或从空白开始</span></button></div><div class="sectionhead"><h2>给灵感一个起点</h2><span class="muted tiny">原创示例模板 · 不会自动生成内容</span></div><div class="template-grid">${templates
    .slice(1)
    .map((t) =>
      b(
        "new-project",
        `<strong>${t.title}</strong><small>${t.subtitle}</small>`,
        "template-option",
        `data-template="${t.id}"`,
      ),
    )
    .join("")}</div></div>`;
}
export function overviewPage() {
  const p = S.project,
    ss = p.shots;
  const total = ss.reduce((n, s) => n + s.duration, 0),
    cost = ss.reduce((n, s) => n + s.cost, 0);
  return `<div class="page"><div class="pageheading row between"><div><div class="eyebrow">PROJECT OVERVIEW</div><h1 style="margin-top:8px">${esc(p.title)}</h1><p>${esc(p.logline || "为这个项目写下一句话故事。")}</p></div><div class="row">${b("edit-project", icon("settings") + " 项目设定")}${b("navigate", icon("film") + " 进入分镜", "primary", 'data-page="storyboard"')}</div></div>${metrics(
    [
      ["计划分集", p.episodes.length, "集"],
      ["镜头总时长", total, "秒"],
      [
        "制作进度",
        ss.length
          ? Math.round(
              (ss.filter((s) => s.status === "已完成").length / ss.length) *
                100,
            )
          : 0,
        "%",
      ],
      ["已记录费用", "¥" + cost.toFixed(0), "预算 ¥" + p.budget],
    ],
  )}<div class="editor-layout"><div><div class="sectionhead"><h2>分集管理</h2>${b("new-episode", icon("plus") + " 添加分集", "ghost")}</div><div class="panel">${
    p.episodes
      .map((e, i) => {
        let s = ss.filter((s) => s.episodeId === e.id);
        return `<div class="step-row pad row" style="border-bottom:1px solid var(--line)"><span class="mono muted" style="margin-right:12px">EP.${num(i + 1)}</span><div class="grow"><h3>${esc(e.title)}</h3><p class="tiny" style="margin-top:5px">${esc(e.synopsis || "暂无分集梗概")}</p></div><span class="tiny muted">${s.length} 镜头</span>${b("open-episode", icon("arrow"), "iconbtn", `data-id="${e.id}" aria-label="打开分集"`)}</div>`;
      })
      .join("") ||
    empty(
      "还没有分集",
      "添加第一集，开始书写你的故事。",
      "new-episode",
      "添加分集",
    )
  }</div><div class="sectionhead"><h2>制作流程</h2></div><div class="panel pad"><div class="row wrap">${[
    ["script", "剧本", "script"],
    ["characters", "角色", "users"],
    ["scenes", "场景", "scene"],
    ["storyboard", "分镜", "film"],
    ["assets", "素材", "folder"],
    ["delivery", "交付", "down"],
  ]
    .map(
      ([page, name, ico], i) =>
        `${i ? '<span class="muted">/</span>' : ""}${b("navigate", icon(ico) + " " + name, "ghost", `data-page="${page}"`)}`,
    )
    .join(
      "",
    )}</div></div></div><aside><div class="sidecard panel"><span class="eyebrow">CREATIVE BIBLE</span><h3>${esc(p.genre)} · ${esc(p.style)}</h3><p>${esc(p.setting || "尚未填写世界与场景设定。在项目设定中补充，用于约束 AI 创作。")}</p><div class="row wrap"><span class="badge">${esc(p.ratio)}</span><span class="badge">${p.characters.length} 位角色</span><span class="badge">${p.scenes.length} 个场景</span></div></div><div class="sidecard panel"><div class="row between"><h3>创作备注</h3>${b("edit-project", icon("script"), "iconbtn ghost", 'aria-label="编辑创作备注"')}</div><p>${esc(p.notes || "记录连续性要求、题材边界、考据来源和暂未确定的创意。")}</p></div><div class="sidecard panel"><h3>版本与备份</h3><p>每次保存保留历史版本，最多 50 条。交付包包含剧本、分镜和原始素材。</p><div class="row">${b("versions", "历史版本")}${b("export-json", "导出草稿", "ghost")}</div></div></aside></div></div>`;
}
export function scriptPage() {
  const e = episode();
  if (!e)
    return `<div class="page">${empty("先添加一个分集", "每个分集有独立剧本与分镜。", "new-episode", "添加分集")}</div>`;
  return `<div class="page"><div class="pageheading row between"><div><h1>剧本创作</h1><p>给人物一个目标，让故事真正发生。</p></div><div class="row">${episodeSelect()}${b("new-episode", icon("plus"), "iconbtn", 'aria-label="添加分集"')}</div></div><div class="editor-layout"><div class="panel"><div class="script-header row between"><div class="grow">${field("分集名称", "episode.title", e.title)}</div><span class="badge" style="margin-left:20px">${esc(S.project.genre)}</span></div><textarea class="script-editor" aria-label="分集剧本" data-bind="episode.script" placeholder="场景一　内景 / 夜\n\n谁在这里？他想要什么？又是什么打断了他？\n\n写下动作、对白和人物选择，用空行分隔段落。">${esc(e.script)}</textarea><div class="script-footer"><span id="word-count">${e.script.length} 字符</span><span>自动保存 · 版本记录</span></div></div><aside class="editor-aside"><div class="panel sidecard"><div class="row between"><h3>AI 编剧助手</h3><span class="ai-mark">${icon("spark")} AI</span></div><p>携带项目设定和角色档案创作。生成结果先预览，由你决定是否采用。</p><div class="field"><label for="script-intent">这次需要什么帮助？</label><select id="script-intent"><option value="draft">根据梗概起草本集剧本</option><option value="rewrite">重写现有剧本，增强人物动机</option><option value="dialogue">润色对白，保持人物口吻</option><option value="review">审查情节与连续性问题</option></select></div><div class="field"><label for="script-instruction">补充要求</label><textarea id="script-instruction" placeholder="例如：控制在90秒，两个角色，一个场景。不要过早揭晓秘密。"></textarea></div>${b("generate-script", icon("spark") + " 提交创作任务", "primary inspector-generate")}${providerHint("text")}</div><div class="panel sidecard">${field("本集梗概", "episode.synopsis", e.synopsis, { multi: true })}<div class="divider"></div><h3>把文字变成镜头</h3><p>AI 会拆解景别、动作和时长，结果作为候选保存，不会覆盖现有镜头。</p>${b("generate-shotlist", icon("film") + " AI 拆解分镜", "inspector-generate")}${b("split-paragraphs", "按空行拆分（不调用 AI）", "ghost inspector-generate")}</div></aside></div></div>`;
}
export function episodeSelect() {
  return `<select class="episode-select" id="episode-select" aria-label="选择分集">${S.project.episodes.map((e) => `<option value="${e.id}" ${episode()?.id === e.id ? "selected" : ""}>${esc(e.title)}</option>`).join("")}</select>`;
}
export function providerHint(mode) {
  const c = S.config.providers[mode];
  return `<p class="tiny muted">${c.configured ? "已配置 " + esc(c.model) + " · 生成会产生服务商费用" : "尚未配置 API 密钥，可先完成编辑与素材整理"}</p>`;
}
export function entitiesPage(type) {
  const isChar = type === "characters",
    list = S.project[type];
  return `<div class="page"><div class="pageheading row between"><div><h1>${isChar ? "角色档案" : "场景设定"}</h1><p>${isChar ? "锁定面容、服装与动机，让角色在每个镜头里始终如一。" : "建立可复用的空间、光线和环境，让故事有一致的世界。"}</p></div>${b("edit-entity", icon("plus") + (isChar ? " 新建角色" : " 新建场景"), "primary", `data-type="${type}"`)}</div><div class="cards-grid">${list.map((c, i) => `<article class="panel entity-card"><div class="entity-portrait">${imageURL(c.referenceId) ? `<img src="${imageURL(c.referenceId)}" alt="${esc(c.name)}参考图">` : `<span class="entity-letter">${esc(c.name.slice(0, 1) || "？")}</span>`}<span class="badge" style="position:absolute;top:12px;left:12px;background:#121b17b0">${isChar ? "CHARACTER" : "LOCATION"} ${num(i + 1)}</span></div><div class="pad"><div class="row between"><h2>${esc(c.name)}</h2><span class="tiny muted">${esc(isChar ? c.role : "场景资产")}</span></div><p>${esc((isChar ? c.appearance : c.description) || "尚未填写详细设定")}</p><div class="row between"><span class="badge ${c.referenceId ? "green" : ""}">${c.referenceId ? "已绑定参考图" : "待建立视觉参考"}</span>${b("edit-entity", "编辑 " + icon("arrow"), "ghost", `data-type="${type}" data-id="${c.id}"`)}</div></div></article>`).join("") || `<div class="panel full">${empty(isChar ? "先认识你的主角" : "给故事一个发生的地方", isChar ? "记录外貌、服装和行动目标，上传定妆参考图，或使用 AI 制作。" : "记录场景布局、光线和气氛，生成或上传场景参考。", "edit-entity", isChar ? "添加角色" : "添加场景", isChar ? "users" : "scene")}</div>`}</div></div>`;
}
export function storyboardPage() {
  const ss = shots(),
    s = shot(),
    p = S.project;
  if (!episode())
    return `<div class="page">${empty("还没有分集", "先建立分集，再开始分镜。", "new-episode", "添加分集")}</div>`;
  let n = ss.findIndex((x) => x.id === s?.id);
  const visual = s
    ? S.mode === "video"
      ? asset(s.videoId)
      : asset(s.imageId)
    : null;
  return `<div class="workspace-tools"><div class="row">${episodeSelect()}<span class="tiny muted">${ss.length} 镜头 · ${ss.reduce((v, s) => v + s.duration, 0)}s</span></div><div class="row">${b("preview", icon("play") + " 顺序预览")}${b("toggle-shot-table", "分镜总表")}${b("add-shot", icon("plus") + " 添加镜头", "primary")}</div></div><div class="shot-workspace"><aside class="shot-list"><div class="shot-list-head row between"><span class="eyebrow">SHOT LIST</span><span class="mono muted">${num(ss.length)}</span></div>${ss.map((x, i) => `<button class="shot-entry ${x.id === s?.id ? "active" : ""}" data-action="select-shot" data-id="${x.id}"><span class="shot-thumb">${imageURL(x.imageId) ? `<img src="${imageURL(x.imageId)}" alt="">` : num(i + 1)}</span><span><strong>${esc(x.title || "未命名镜头")}</strong><small>${x.duration}s · ${esc(x.status)}</small></span></button>`).join("") || '<p class="tiny muted" style="padding:12px">从第一格分镜开始。</p>'}</aside><div class="shot-stage">${s ? `<div class="stage-toolbar"><div class="row"><span class="mono">SHOT ${num(n + 1)}</span>${statusTag(s.status)}</div><div class="row">${b("move-shot", icon("up"), "iconbtn ghost", 'aria-label="上移镜头"')}${b("duplicate-shot", icon("copy"), "iconbtn ghost", 'aria-label="复制镜头"')}${b("delete-shot", icon("trash"), "iconbtn ghost danger", 'aria-label="删除镜头"')}</div></div><div class="stage-viewport">${visual ? (visual.mime.startsWith("video/") ? `<video controls playsinline src="${visual.url}"></video>` : `<img src="${visual.url}" alt="当前镜头画面">`) : `<div class="frame-guide"></div><div class="stage-empty">${icon(S.mode === "video" ? "video" : "image")}<p>${S.mode === "video" ? "让这一帧，开始发生。" : "你的下一格画面，从这里开始。"}</p><small>${S.mode === "video" ? "填写动作与运镜，生成视频或绑定现有素材" : "写下画面描述，生成图片或绑定现有素材"}</small></div>`}</div><div class="stage-under"><span>${esc(p.ratio)} / ${esc(p.style)} / ${s.duration}s</span><div class="row">${b("bind-asset", icon("link") + " 绑定素材", "ghost tiny", `data-target="shot.${S.mode === "video" ? "videoId" : "imageId"}" data-filter="${S.mode}"`)}${b("upload-for-shot", icon("upload"), "iconbtn ghost", 'aria-label="上传镜头素材"')}</div></div><div class="stage-notes"><div>${field("画面与动作", "shot.action", s.action, { multi: true })}${field("对白", "shot.dialogue", s.dialogue, { multi: true })}</div><div>${field("景别与运镜", "shot.camera", s.camera)}${field("声音与环境", "shot.sound", s.sound)}${field("连续性备注", "shot.continuity", s.continuity, { multi: true })}</div></div><div class="review-strip row between"><div><h3 style="font-size:11px">候选结果保存在生成任务中</h3><p>审核后采用，原素材保留在素材库，可随时重新绑定。</p></div>${b("navigate", "查看任务 " + icon("arrow"), "ghost tiny", 'data-page="jobs"')}</div>` : empty("第一场戏，还缺第一格分镜", "添加镜头，或回到剧本页让 AI 拆解。", "add-shot", "添加镜头")}</div><aside class="shot-inspector">${s ? `<div class="inspector-head"><h3>镜头设置</h3><span class="mono muted">${num(n + 1)} / ${num(ss.length)}</span></div><div class="inspector-tabs">${b("set-mode", icon("image") + " 图片", S.mode === "image" ? "active" : "", 'data-mode="image"')}${b("set-mode", icon("video") + " 视频", S.mode === "video" ? "active" : "", 'data-mode="video"')}</div>${field("镜头名称", "shot.title", s.title)}<div class="fields2">${field("时长 / 秒", "shot.duration", s.duration, { type: "number" })}${field("制作状态", "shot.status", s.status, { options: ["待制作", "制作中", "待审核", "已完成"] })}</div>${field("场景", "shot.sceneId", s.sceneId, { options: [{ value: "", label: "未绑定场景" }, ...p.scenes.map((x) => ({ value: x.id, label: x.name }))] })}<div class="field"><label>出场角色</label><div class="chips">${p.characters.map((c) => `<label class="chip"><input type="checkbox" data-character="${c.id}" ${s.characterIds.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("") || '<span class="tiny muted">先在角色档案中建立角色。</span>'}</div></div><div class="divider"></div><div class="row between" style="margin-bottom:12px"><h3 style="font-size:12px">生成提示词</h3>${b("build-prompt", icon("refresh") + " 从设定构建", "ghost tiny")}</div>${field("提示词", "shot.prompt", s.prompt, { multi: true, rows: 6, help: "构建时合并角色、场景和动作。可以继续手动修改。" })}${field("避免出现", "shot.negative", s.negative, { multi: true })}${S.mode === "video" ? '<div class="notice warning">人脸参考、片长与分辨率受所选服务商限制。先测试短镜头，再扩展制作。</div>' : ""}<div class="row between tiny muted" style="margin-bottom:12px"><span>${esc(S.config.providers[S.mode].model)}</span><span>质量优先</span></div>${b("generate-media", icon("spark") + (S.mode === "image" ? " 生成镜头图片" : " 生成镜头视频"), "primary inspector-generate")}${providerHint(S.mode)}${field("实际费用 / 元", "shot.cost", s.cost, { type: "number", help: "手动记录账单费用；不以估算替代实际扣费。" })}` : '<p class="muted tiny">选中镜头后可编辑属性、关联角色与发起生成。</p>'}</aside></div>${ss.length ? `<div class="timeline"><div class="row between"><span class="eyebrow">EPISODE TIMELINE</span><span class="tiny muted">${esc(episode().title)} · ${ss.reduce((v, x) => v + x.duration, 0)} 秒</span></div><div class="timeline-track">${ss.map((x, i) => `<button class="timeline-block ${x.id === s?.id ? "active" : ""}" data-action="select-shot" data-id="${x.id}">${imageURL(x.imageId) ? `<img src="${imageURL(x.imageId)}" alt="">` : ""}<span>${num(i + 1)} · ${x.duration}s</span></button>`).join("")}</div><div class="ruler"><span>00:00</span><span>故事的时间，逐格向前</span><span>${ss.reduce((v, x) => v + x.duration, 0)}s</span></div></div>` : ""}`;
}
export function assetsPage() {
  const list = S.assets.filter(
    (a) =>
      (S.assetFilter === "all" || a.mime.startsWith(S.assetFilter + "/")) &&
      a.name.toLowerCase().includes(S.assetSearch.toLowerCase()),
  );
  return `<div class="page"><div class="pageheading row between"><div><h1>素材库</h1><p>集中保存角色定妆、场景参考、镜头画面与视频候选。</p></div>${b("upload-asset", icon("upload") + " 上传素材", "primary")}</div><div class="filterbar"><input id="asset-search" aria-label="搜索素材" placeholder="搜索素材名称…" value="${esc(S.assetSearch)}"><select id="asset-filter" aria-label="素材类型">${[
    ["all", "全部素材"],
    ["image", "图片"],
    ["video", "视频"],
    ["audio", "音频"],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${S.assetFilter === v ? "selected" : ""}>${t}</option>`,
    )
    .join(
      "",
    )}</select><span class="tiny muted">${list.length} 项 · 单文件最大 100MB</span></div><div class="assets-grid">${list.map((a) => `<article class="panel asset-card"><div class="asset-preview">${a.mime.startsWith("image/") ? `<img src="${a.url}" alt="${esc(a.name)}" loading="lazy">` : a.mime.startsWith("video/") ? `<video src="${a.url}" controls preload="metadata"></video>` : `<audio src="${a.url}" controls preload="metadata"></audio>`}</div><div class="pad"><h3 title="${esc(a.name)}">${esc(a.name)}</h3><p>${(a.size / 1024 / 1024).toFixed(2)}MB · ${a.source === "upload" ? "上传" : "AI 生成"} · ${fmtDate(a.created_at)}</p><div class="row between"><span class="badge">${a.mime.split("/")[1].toUpperCase()}</span><a class="tiny muted" href="${a.url}?download=1" download>下载原文件 ↗</a></div></div></article>`).join("") || `<div class="panel full">${empty("让素材聚在一起", "上传已有素材，或在分镜工作台生成第一张画面。", "upload-asset", "上传素材", "folder")}</div>`}</div></div>`;
}
const kindLabel = {
  script: "剧本创作",
  shotlist: "分镜拆解",
  image: "图片生成",
  video: "视频生成",
};
function jobProgress(j) {
  if (!["running", "submitted"].includes(j.state)) return "";
  if (
    j.kind === "video" &&
    j.request.adapter === "openai" &&
    j.state === "submitted" &&
    j.progress > 0
  ) {
    return `<div><div class="progress" style="--progress:${j.progress}%"><div></div></div><p class="tiny muted">服务商进度约 ${j.progress}%</p></div>`;
  }
  return `<span class="badge amber">等待服务商结果</span>`;
}

export function jobsPage() {
  let jobs = S.jobs.filter(
    (j) =>
      S.jobFilter === "all" ||
      (S.jobFilter === "active"
        ? ["queued", "running", "submitted"].includes(j.state)
        : j.state === S.jobFilter),
  );
  return `<div class="page"><div class="pageheading row between"><div><h1>生成任务</h1><p>每一次尝试都有记录。结果审核后采用，保留创作的选择权。</p></div>${b("refresh-jobs", icon("refresh") + " 刷新")}</div><div class="filterbar"><select id="job-filter" aria-label="任务状态">${[
    ["all", "全部任务"],
    ["active", "正在处理"],
    ["completed", "已完成"],
    ["failed", "失败"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${S.jobFilter === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select><span class="tiny muted">最近 100 个任务 · 每 5 秒更新状态</span></div><div class="jobs-list">${jobs.map((j) => `<article class="panel job-card"><div class="job-icon">${icon(j.kind === "image" ? "image" : j.kind === "video" ? "video" : j.kind === "script" ? "script" : "film")}</div><div class="grow"><div class="row"><h3>${j.request.characterId ? "角色形象 · " + esc(j.request.characterName || "") : kindLabel[j.kind]}</h3>${statusTag(j.state)}</div><p>${esc(j.error || j.request.prompt.slice(0, 100))}</p><div class="tiny muted" style="margin-top:8px">${esc(j.request.model)} · ${new Date(j.created_at).toLocaleString("zh-CN")} · ${j.id.slice(0, 8)}</div></div>${jobProgress(j)}${j.state === "completed" ? b("job-result", "查看结果 " + icon("arrow"), "primary", `data-id="${j.id}"`) : j.state === "queued" ? b("cancel-job", "取消", "ghost", `data-id="${j.id}"`) : j.state === "failed" ? b("retry-job", icon("refresh") + " 重新提交", "", `data-id="${j.id}"`) : ""}</article>`).join("") || `<div class="panel">${empty("每个好镜头，都从一次尝试开始", "在剧本页发起创作任务，或在分镜页生成图片与视频。", "navigate", "去分镜工作台", "spark")}</div>`}</div></div>`;
}
export function settingsPage() {
  return `<div class="page"><div class="pageheading"><h1>模型与工作室设置</h1><p>服务端保管密钥。按任务选择模型，把质量、成本和控制权留在自己手里。</p></div><div class="notice">模型 API 为真实接入。配置密钥后才会向服务商提交任务；未配置时只进行本地创作与管理。本文本模型默认采用已核对的 GPT-6 Astra，图像采用 GPT Image 2.5 Flare 最高质量档，视频提供 OpenAI 与 Seedance 两种适配器；模型名可随账号权限更换。</div><div class="settings-grid">${[
    "text",
    "image",
    "video",
  ]
    .map((k, i) => {
      let c = S.config.providers[k];
      return `<article class="panel provider-card"><div class="provider-title"><div class="provider-icon">${icon(["script", "image", "video"][i])}</div><div class="grow"><h2>${["文本与编剧", "图像与定妆", "视频与镜头"][i]}</h2><p class="tiny">${["剧本起草 / 对白润色 / 结构化分镜", "角色参考 / 场景设计 / 镜头关键帧", "文生视频 / 首帧参考 / 异步任务"][i]}</p></div><span class="badge ${c.configured ? "green" : "amber"}">${c.configured ? "已配置" : "待配置"}</span></div><div class="row between"><span class="muted tiny">当前模型</span><code>${esc(c.model)}</code></div><div class="row between" style="margin-top:12px"><span class="muted tiny">接口适配器</span><span class="mono">${esc(c.adapter)}</span></div><div class="divider"></div><p class="tiny muted">在服务器 .env 中配置 <code>${k.toUpperCase()}_API_KEY</code>、<code>${k.toUpperCase()}_MODEL</code> 与 <code>${k.toUpperCase()}_BASE_URL</code>，重启服务生效。</p></article>`;
    })
    .join(
      "",
    )}<article class="panel provider-card"><div class="provider-title"><div class="provider-icon">${icon("folder")}</div><div><h2>独立部署 · 数据归你</h2><p class="tiny">单人工作室版本 / v${S.config.version}</p></div></div><p class="tiny muted">项目、历史版本与任务保存到 SQLite；原始素材保存到服务器磁盘。容器重建不影响数据卷。定期备份整个 data 目录。</p><div class="divider"></div><div class="row between"><span class="muted tiny">存储方式</span><span class="tiny">${S.config.storage}</span></div><div class="row between" style="margin-top:12px"><span class="muted tiny">素材上传上限</span><span class="mono">100MB / FILE</span></div></article></div><div class="sectionhead"><h2>部署配置示例</h2></div><pre>OPENAI_API_KEY=在服务器配置，勿提交 GitHub
TEXT_MODEL=gpt-6-astra
IMAGE_MODEL=gpt-image-2.5-flare
IMAGE_QUALITY=max
VIDEO_MODEL=sora-2-pro

# 使用火山引擎视频时：
VIDEO_ADAPTER=seedance
VIDEO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VIDEO_API_KEY=在服务器配置
VIDEO_MODEL=填写你已开通的视频模型 ID</pre><p class="tiny muted">没有对所有题材都最好的单一模型。真人参考图、人物一致性、动作复杂度与可用地域都需要用实际样片验证。当前未包含多人协作、自动口型配音及完整非线性剪辑。</p></div>`;
}
export function deliveryPage() {
  const p = S.project,
    ss = p.shots,
    done = ss.filter((s) => s.status === "已完成").length;
  return `<div class="page"><div class="pageheading row between"><div><h1>审核与交付</h1><p>检查连续性、整理成本，把项目交接给下一道工序。</p></div>${b("export-package", icon("down") + " 下载完整交付包", "primary")}</div>${metrics(
    [
      ["已完成镜头", done + "/" + ss.length, "个"],
      ["绑定图片", ss.filter((s) => s.imageId).length, "个"],
      ["绑定视频", ss.filter((s) => s.videoId).length, "个"],
      [
        "已记录费用",
        "¥" + ss.reduce((n, s) => n + s.cost, 0).toFixed(0),
        "实际费用",
      ],
    ],
  )}<div class="editor-layout"><section><div class="panel table-wrap"><table><thead><tr><th>镜头</th><th>场景与角色</th><th>时长</th><th>素材</th><th>状态</th></tr></thead><tbody>${
    ss
      .map(
        (s, i) =>
          `<tr><td><span class="mono muted">${num(i + 1)}</span>　${esc(s.title)}</td><td>${esc(p.scenes.find((x) => x.id === s.sceneId)?.name || "未绑定场景")}<br><span class="muted tiny">${esc(
            p.characters
              .filter((c) => s.characterIds.includes(c.id))
              .map((c) => c.name)
              .join(" / ") || "未绑定角色",
          )}</span></td><td>${s.duration}s</td><td><span class="badge ${s.imageId ? "green" : ""}">图</span> <span class="badge ${s.videoId ? "green" : ""}">影</span></td><td>${statusTag(s.status)}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="5">还没有分镜，完成剧本后开始制作。</td></tr>'
  }</tbody></table></div><div class="notice">交付包包括项目 JSON、制作手册 Markdown、分镜 CSV 与全部原始素材。成片精剪、混音与调色请在剪辑软件中完成。</div></section><aside><div class="panel sidecard"><h3>交付格式</h3><p>完整包用于交接；项目 JSON 用于备份文字档案。分集字幕按镜头顺序和时长导出。</p><div style="display:grid;gap:9px">${b("export-json", icon("down") + " 项目 JSON")}${b("export-srt", icon("down") + " 当前分集字幕 SRT")}${b("export-markdown", icon("down") + " 制作手册 Markdown")}${b("preview", icon("play") + " 当前分集顺序预览")}</div></div><div class="panel sidecard"><h3>审核重点</h3><p>人物面容与服装是否一致？<br>动作方向、道具与伤势是否连续？<br>对白与字幕是否对应？<br>音乐、素材与声音是否有使用权？<br>是否完成发布平台要求的标识与审核？</p></div></aside></div></div>`;
}
