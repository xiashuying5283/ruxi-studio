export const S = {
  csrf: "",
  projects: [],
  project: null,
  assets: [],
  jobs: [],
  config: null,
  page: "projects",
  episodeId: "",
  shotId: "",
  mode: "image",
  assetFilter: "all",
  assetSearch: "",
  jobFilter: "all",
  dirty: false,
  saving: false,
  saveError: "",
  edit: 0,
  playing: false,
};
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const id = () => crypto.randomUUID();
export const fmtDate = (s) =>
  s
    ? new Date(s).toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      })
    : "";
export function toast(text) {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4000);
}
export async function api(path, { method = "GET", body, form } = {}) {
  const res = await fetch("/api" + path, {
    method,
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Token": S.csrf } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  let d;
  try {
    d = await res.json();
  } catch {
    throw Error("服务器响应异常，请检查网络连接");
  }
  if (!res.ok) {
    let e = Error(d.error || "请求失败");
    e.status = res.status;
    throw e;
  }
  return d;
}
export function download(name, content, type = "application/json") {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let timer;
let inFlight;
export function markDirty() {
  S.dirty = true;
  S.edit++;
  S.saveError = "";
  try {
    sessionStorage.setItem(
      "ruxi-draft-" + S.project.id,
      JSON.stringify(S.project),
    );
  } catch {}
  setSaveLabel();
  clearTimeout(timer);
  timer = setTimeout(() => save().catch((e) => toast(e.message)), 1000);
}
function setSaveLabel() {
  if (!S.dirty && !S.saving)
    document.querySelector("#draft-button")?.classList.add("hide");
  const el = document.querySelector("#save-label");
  if (el)
    el.textContent = S.saveError
      ? "保存失败 · 可导出草稿"
      : S.saving
        ? "正在保存…"
        : S.dirty
          ? "未保存"
          : "已保存到服务器";
}
export async function save() {
  clearTimeout(timer);
  if (inFlight) {
    await inFlight;
    if (S.dirty) return save();
    return;
  }
  if (!S.project || !S.dirty) return;
  const version = S.edit;
  const snapshot = structuredClone(S.project);
  S.saving = true;
  setSaveLabel();
  inFlight = (async () => {
    try {
      const result = await api("/projects/" + snapshot.id, {
        method: "PUT",
        body: snapshot,
      });
      S.project.revision = result.revision;
      S.project.updated_at = result.updated_at;
      S.dirty = S.edit !== version;
      S.projects = S.projects.map((p) =>
        p.id === result.id ? structuredClone(S.project) : p,
      );
      if (!S.dirty) sessionStorage.removeItem("ruxi-draft-" + snapshot.id);
      S.saveError = "";
    } catch (e) {
      S.saveError = e.message;
      throw e;
    } finally {
      S.saving = false;
      setSaveLabel();
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
export const episode = () =>
  S.project?.episodes.find((x) => x.id === S.episodeId) ||
  S.project?.episodes[0];
export const shots = () =>
  S.project?.shots.filter((s) => s.episodeId === episode()?.id) || [];
export const shot = () => shots().find((s) => s.id === S.shotId) || shots()[0];
export const asset = (aid) => S.assets.find((a) => a.id === aid);
export function imageURL(aid) {
  return asset(aid)?.mime.startsWith("image/") ? asset(aid).url : "";
}
export const newShot = (epid) => ({
  id: id(),
  episodeId: epid,
  title: "新镜头",
  sceneId: "",
  characterIds: [],
  action: "",
  dialogue: "",
  sound: "",
  camera: "中景 · 固定机位",
  duration: 4,
  status: "待制作",
  prompt: "",
  negative: "",
  imageId: "",
  videoId: "",
  cost: 0,
  continuity: "",
});
export function baseProject() {
  return {
    title: "",
    genre: "剧情",
    style: "真人电影",
    ratio: "9:16",
    logline: "",
    setting: "",
    notes: "",
    budget: 1000,
    episodes: [{ id: id(), title: "第 01 集", synopsis: "", script: "" }],
    characters: [],
    scenes: [],
    shots: [],
  };
}
export const templates = [
  {
    id: "blank",
    title: "自由创作",
    subtitle: "从一个想法开始",
    genre: "剧情",
    style: "真人电影",
    logline: "",
  },
  {
    id: "mystery",
    title: "悬疑 · 雨夜来电",
    subtitle: "密闭空间 / 双人博弈",
    genre: "悬疑",
    style: "真人电影",
    logline: "深夜的值班室里，一个陌生来电准确说出了保安下一分钟会做的事。",
    setting: "当代都市。一间值班室、一部电话和一扇看不清外面的玻璃门。",
  },
  {
    id: "romance",
    title: "爱情 · 明天见",
    subtitle: "都市生活 / 温暖轻喜剧",
    genre: "爱情",
    style: "真人电影",
    logline: "一对决定分手的恋人，被迫共同照顾一只只肯跟两人一起散步的小狗。",
    setting: "当代都市。狭小但充满生活痕迹的合租公寓。",
  },
  {
    id: "scifi",
    title: "科幻 · 最后一班",
    subtitle: "未来世界 / 情感选择",
    genre: "科幻",
    style: "真人电影",
    logline: "星际列车的末班车上，一名检票员发现唯一的乘客是十年前失踪的自己。",
    setting: "近未来的星际铁路。车厢外是寂静星海，车厢内仍沿用老式纸质车票。",
  },
  {
    id: "comedy",
    title: "喜剧 · 今日营业",
    subtitle: "小人物 / 日常荒诞",
    genre: "喜剧",
    style: "二维动画",
    logline: "一家只卖后悔药的便利店，今天来了一个从不后悔的人。",
    setting: "一座普通城市里不太普通的街角便利店。",
  },
  {
    id: "wuxia",
    title: "古装 · 夜渡",
    subtitle: "江湖悬疑 / 人物抉择",
    genre: "武侠",
    style: "真人电影",
    logline:
      "年轻渡夫认出了负伤客人带来的断刀，却仍将船撑向河心，追问父亲的下落。",
    setting: "架空古代。夜间渡口、薄雾、湿木船板；器物与服饰细节待核验。",
  },
];
export function shotPrompt(s) {
  if (!s) return "";
  const p = S.project;
  const scene = p.scenes.find((x) => x.id === s.sceneId);
  const characters = p.characters.filter((c) => s.characterIds.includes(c.id));
  return [
    p.style + "，" + p.genre + "题材，画幅 " + p.ratio + "。",
    p.setting,
    scene
      ? `场景：${scene.name}。${scene.description}。光线：${scene.lighting}。`
      : "",
    characters
      .map((c) => `角色 ${c.name}：${c.appearance}；服装与道具：${c.costume}。`)
      .join("\n"),
    `镜头：${s.camera}。画面动作：${s.action}。`,
    s.dialogue ? "对白：" + s.dialogue : "",
    s.sound ? "声音：" + s.sound : "",
    s.continuity ? "连续性要求：" + s.continuity : "",
    s.negative ? "避免：" + s.negative : "",
  ]
    .filter(Boolean)
    .join("\n");
}
