let pageSeq = 0;
const pages = []; // { id, layout, sets: [{dwg,location,content,date,photo:File|null}, ...] }

const pagesEl = document.getElementById("pages");
const pageTpl = document.getElementById("pageTemplate");
const setCardTpl = document.getElementById("setCardTemplate");

// 사진 1장 = 세트 1개(독립된 기기번호/작업구역/작업내용/날짜). 4장 레이아웃은 4세트, 2장은 2세트.
const SET_LABELS = {
  "4": ["상단 좌", "상단 우", "하단 좌", "하단 우"],
  "2": ["상단", "하단"],
};

function setsCountFor(layout) {
  return layout === "4" ? 4 : 2;
}

function emptySet() {
  return { dwg: "", location: "", content: "", date: "", photo: null };
}

function isSetEmpty(s) {
  return !s.dwg && !s.location && !s.content && !s.date && !s.photo;
}

// 아무것도 입력 안 된 기본 첫 페이지만 있으면 제거해서, 사진 삽입이 페이지 1부터 시작하도록 한다.
function clearLeadingEmptyPage() {
  if (pages.length === 1 && pages[0].sets.every(isSetEmpty)) {
    pages.length = 0;
    pagesEl.innerHTML = "";
  }
}

function renderPageNumbers() {
  [...pagesEl.children].forEach((el, idx) => {
    el.querySelector(".page-title").textContent = `페이지 ${idx + 1}`;
  });
}

function addPage(initial) {
  const id = pageSeq++;
  const layout = (initial && initial.layout) || "4";
  const sets = (initial && initial.sets) || Array.from({ length: setsCountFor(layout) }, emptySet);
  const state = { id, layout, sets };
  pages.push(state);

  const node = pageTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  node.dataset.layout = layout; // 2장 레이아웃은 "상단/하단"이 실제 인쇄물처럼 세로로 쌓이도록 CSS에서 참조

  node.querySelector(".remove-page").addEventListener("click", () => {
    const idx = pages.findIndex((p) => p.id === id);
    if (idx >= 0) pages.splice(idx, 1);
    node.remove();
    renderPageNumbers();
  });

  pagesEl.appendChild(node);
  renderSets(node, state);
  renderPageNumbers();
}

// 레이아웃에 맞는 개수만큼 "세트" 카드를 그린다. 사진 1장 = 세트 1개.
function renderSets(node, state) {
  const blocksEl = node.querySelector(".blocks");
  blocksEl.innerHTML = "";
  const labels = SET_LABELS[state.layout];
  state.sets.forEach((setState, idx) => {
    const card = setCardTpl.content.firstElementChild.cloneNode(true);
    card.querySelector(".set-title").textContent = labels[idx];

    card.querySelectorAll("input[data-field]").forEach((input) => {
      input.value = setState[input.dataset.field] || "";
      input.addEventListener("input", () => {
        setState[input.dataset.field] = input.value;
      });
    });

    renderSetPhoto(card, setState);
    blocksEl.appendChild(card);
  });
}

// 세트 하나의 사진 슬롯(항상 1장)을 그린다. 채워지면 썸네일+삭제, 비어있으면 업로드 버튼.
function renderSetPhoto(card, setState) {
  const container = card.querySelector(".photos");
  container.innerHTML = "";
  const slot = document.createElement("div");
  slot.className = "photo-slot";

  if (setState.photo) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(setState.photo);
    slot.appendChild(img);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "slot-remove link-btn";
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", () => {
      setState.photo = null;
      renderSetPhoto(card, setState);
    });
    slot.appendChild(removeBtn);
  } else {
    const label = document.createElement("label");
    label.className = "slot-add";
    label.textContent = "사진 추가";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const f = input.files[0];
      if (!f) return;
      setState.photo = f;
      renderSetPhoto(card, setState);
      if (!setState.content) {
        deriveContentForFile(f).then((derived) => {
          if (derived && !setState.content) {
            setState.content = derived;
            const contentInput = card.querySelector('input[data-field="content"]');
            if (contentInput) contentInput.value = derived;
          }
        });
      }
    });
    label.appendChild(input);
    slot.appendChild(label);
  }
  container.appendChild(slot);
}

// 파일명에서 순번/확장자/날짜 접미어를 제거해 의미 있는 텍스트만 남긴다.
function contentFromFilename(name) {
  let base = name.replace(/\.[a-zA-Z0-9]+$/, "");
  base = base.replace(/^[\s()\-_.\d]+/, "");
  base = base.replace(/[\s_\-]*\d{4}[.\-_]\d{1,2}[.\-_]\d{1,2}.*$/, "");
  base = base.replace(/[\s_\-]+\(?\d+\)?$/, "");
  base = base.replace(/[_\-]+/g, " ").trim();
  return base;
}

// IMG_1234, KakaoTalk_20260618_..., 20260707_154023 등 정보 없는 카메라/메신저 파일명 패턴
function looksGenericFilename(s) {
  const stripped = s.replace(/\s+/g, "");
  if (!stripped) return true;
  if (/^\d+$/.test(stripped)) return true;
  if (/^(img|dsc|dscf|photo|picture|image|kakaotalk|screenshot|캡처|스크린샷)\d*$/i.test(stripped)) return true;
  return false;
}

// JPEG APP1(Exif) IFD0에서 ImageDescription(0x010E) 태그만 최소 파싱으로 읽는다.
async function readExifDescription(file) {
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if (marker === 0xffe1) {
        const segLen = view.getUint16(offset + 2);
        const segStart = offset + 4;
        if (view.getUint32(segStart) === 0x45786966) {
          const tiffStart = segStart + 6;
          const little = view.getUint16(tiffStart) === 0x4949;
          const getU16 = (o) => view.getUint16(o, little);
          const getU32 = (o) => view.getUint32(o, little);
          const ifd0Offset = tiffStart + getU32(tiffStart + 4);
          const numEntries = getU16(ifd0Offset);
          for (let i = 0; i < numEntries; i++) {
            const entryOffset = ifd0Offset + 2 + i * 12;
            const tag = getU16(entryOffset);
            if (tag === 0x010e) {
              const count = getU32(entryOffset + 4);
              const valueOffset = count > 4 ? tiffStart + getU32(entryOffset + 8) : entryOffset + 8;
              let str = "";
              for (let c = 0; c < count - 1; c++) {
                const ch = view.getUint8(valueOffset + c);
                if (ch === 0) break;
                str += String.fromCharCode(ch);
              }
              str = str.trim();
              if (str) return str;
            }
          }
        }
        offset += 2 + segLen;
      } else if (marker === 0xffd8) {
        offset += 2;
      } else if ((marker & 0xff00) === 0xff00) {
        const segLen = view.getUint16(offset + 2);
        offset += 2 + segLen;
      } else {
        break;
      }
    }
  } catch (e) {
    // 파싱 실패 시 무시하고 null 반환
  }
  return null;
}

// 파일명을 우선 시도하고, 의미 없어 보이면 EXIF ImageDescription으로 대체한다.
async function deriveContentForFile(file) {
  const fromName = contentFromFilename(file.name);
  if (fromName && !looksGenericFilename(fromName)) return fromName;
  const fromExif = await readExifDescription(file);
  if (fromExif) return fromExif;
  return null;
}

// "+페이지 추가"도 갤러리 섹션의 "사진 장수" 선택을 그대로 따른다 —
// 레이아웃을 고르는 곳이 이제 그 selector 하나뿐이므로, 수동 추가 페이지도 거기 맞춰야 한다.
document.getElementById("addPage").addEventListener("click", () => {
  addPage({ layout: cloudLayoutSelect.value });
});

// ── work-gallery(Supabase) 연동 ──────────────────────
// work-gallery/index.html과 동일한 프로젝트의 Supabase publishable key (공개 anon key, 비밀값 아님)
const SUPABASE_URL = "https://dteljgmdbfyxubtpogcj.supabase.co";
const SUPABASE_KEY = "sb_publishable_VC2GcwpxDg_zVbFgOnpfzg__sictyqc";
let sbClient = null;
try {
  sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error("Supabase 초기화 실패", e);
}

const cloudModal = document.getElementById("cloudModal");
const cloudList = document.getElementById("cloudList");
const cloudSearch = document.getElementById("cloudSearch");
const cloudWorkTypeFilter = document.getElementById("cloudWorkTypeFilter");
const cloudPhaseFilter = document.getElementById("cloudPhaseFilter");
const cloudPhaseFilterWrap = document.getElementById("cloudPhaseFilterWrap");
const cloudCatFilter = document.getElementById("cloudCatFilter");
const cloudDateFilter = document.getElementById("cloudDateFilter");
const cloudMenuNotice = document.getElementById("cloudMenuNotice");
const cloudStatus = document.getElementById("cloudStatus");
const cloudSelectedCount = document.getElementById("cloudSelectedCount");
const cloudSelectAllBtn = document.getElementById("cloudSelectAll");
const importCloudBtn = document.getElementById("importCloudSelected");

let cloudRecords = [];
const cloudSelected = new Set();

function fileNameFromUrl(url) {
  try {
    return decodeURIComponent(url.split("/").pop().split("?")[0]) || "photo.jpg";
  } catch (e) {
    return "photo.jpg";
  }
}

async function cloudRecordToFile(rec) {
  const resp = await fetch(rec.photo_url);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const blob = await resp.blob();
  return new File([blob], fileNameFromUrl(rec.photo_url), { type: blob.type || "image/jpeg" });
}

// "작업내용" 필드 기본값: 특이사항(note)은 더 이상 참조하지 않고 항상 작업분류(cat)를 사용한다.
// 메뉴(시공/품질/자재/안전/화기유도) 구분 없이 전부 동일한 로직 — cat 필드는 모든 메뉴에서 동일하게 채워지는 값이다.
function noteContentOf(r) {
  return r.cat || "";
}

// 레코드 1개 = 세트 1개(사진 1장 + 고유 필드). 갤러리 레코드 구조와 1:1로 대응된다.
async function cloudRecordToSet(rec) {
  return {
    dwg: rec.tag || "",
    location: rec.loc || "",
    content: noteContentOf(rec),
    date: rec.date || "",
    photo: await cloudRecordToFile(rec),
  };
}

function updateCloudSelectedCount() {
  cloudSelectedCount.textContent = cloudSelected.size > 0 ? `${cloudSelected.size}장 선택됨` : "";
  const filtered = filteredCloudRecords();
  const allSelected = filtered.length > 0 && filtered.every((r) => cloudSelected.has(r.photo_url));
  cloudSelectAllBtn.textContent = allSelected ? "전체 해제" : "전체 선택";
}

// 설정의 "사진관리 구분"으로 1차 필터. 구분을 선택했으면 정확히 그 구분으로 태그된
// 사진만 보여준다(엄격 필터) — 구분 미지정 사진을 섞어 보여주면 "시공 골랐는데 품질도 보임"
// 처럼 필터가 무력화된 것처럼 느껴지므로, 미지정 사진은 "선택 안 함"일 때만 노출한다.
function menuFilteredRecords() {
  const selectedMenu = workTitleInput.value;
  if (!selectedMenu) return cloudRecords;
  return cloudRecords.filter((r) => r.menu === selectedMenu);
}

function populateSelectOptions(selectEl, values) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">전체</option>';
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
  if (values.includes(current)) selectEl.value = current;
}

// work-gallery(work-gallery/index.html WT_LABELS_BY_MENU)와 동일한 메뉴별 작업구분 단계.
// 시공/품질은 신규가 "진행중/완료", 수정이 "변경전/변경후"로 세분화되고,
// 자재/안전/화기유도는 하위 단계 없이 도급-사급 등 값 자체가 구분이다.
const WT_LABELS_BY_MENU = {
  "시공": { new: "신규", mod: "수정", newPhases: ["진행중", "완료"], modPhases: ["변경전", "변경후"] },
  "품질": { new: "신규", mod: "수정", modPhases: ["변경전", "변경후"] },
  "자재": { new: "도급", mod: "사급" },
  "안전": { new: "현장안전점검", mod: "안전용품" },
  "화기/유도": { new: "화기감시자", mod: "유도원" },
};

// work-gallery(work-gallery/index.html workTypeFolderName)와 동일한 폴더 묶음 규칙.
// 시공/품질은 "진행중/완료"→신규, "변경전/변경후/수정-작업전/수정-작업후"(구버전 표기 포함)→수정으로 묶이고,
// 그 외 값(자재의 도급/사급 등, 혹은 이미 "신규"/"수정" 그 자체로 저장된 값)은 원래 값을 폴더명으로 그대로 쓴다.
function workTypeFolderName(wt) {
  if (wt === "변경전" || wt === "변경후" || wt === "수정-작업전" || wt === "수정-작업후") return "수정";
  if (wt === "진행중" || wt === "완료") return "신규";
  return wt || "기타";
}

// 선택된 작업구분(폴더) 값과 레코드가 일치하는지 검사.
function recordInWorkTypeFolder(r, folder) {
  if (!folder) return true;
  return workTypeFolderName(r.work_type) === folder;
}

// 작업구분 드롭다운: work-gallery 사이드바 폴더와 동일하게 신규/수정/기타로 묶어서 보여준다.
// 실제 사진 대부분이 세부단계 없이 "신규" 자체이거나 구분 미지정이므로(예: 시공 620장 중 614장),
// 세부단계(진행중/완료 등)만 옵션으로 노출하면 대부분의 사진을 선택할 수 없게 된다 — 그래서
// 신규/수정/기타를 1차로 두고, 세부단계는 populateCloudPhaseFilter()의 별도 드롭다운으로 분리한다.
function populateCloudWorkTypeFilter() {
  const menu = workTitleInput.value;
  const current = cloudWorkTypeFilter.value;
  const w = WT_LABELS_BY_MENU[menu];
  const values = w ? [w.new, w.mod, "기타"] : [...new Set(menuFilteredRecords().map((r) => workTypeFolderName(r.work_type)))].sort();
  populateSelectOptions(cloudWorkTypeFilter, values);
  if (values.includes(current)) cloudWorkTypeFilter.value = current;
}

// 세부단계 드롭다운(진행중/완료/변경전/변경후): 선택된 메뉴+작업구분(신규/수정)에 하위 단계가 정의된
// 경우에만 나타난다(work-gallery 필터바의 fWt와 동일 개념). 하위 단계가 없는 메뉴·기타 선택 시에는 숨긴다.
function populateCloudPhaseFilter() {
  const menu = workTitleInput.value;
  const w = WT_LABELS_BY_MENU[menu];
  const folder = cloudWorkTypeFilter.value;
  let phases = null;
  if (w && folder === w.new) phases = w.newPhases || null;
  if (w && folder === w.mod) phases = w.modPhases || null;
  if (!phases) {
    cloudPhaseFilter.value = "";
    cloudPhaseFilterWrap.style.display = "none";
    return;
  }
  cloudPhaseFilterWrap.style.display = "";
  const current = cloudPhaseFilter.value;
  populateSelectOptions(cloudPhaseFilter, phases);
  if (phases.includes(current)) cloudPhaseFilter.value = current;
}

// 최하위 폴더(작업분류/cat) 드롭다운은 선택된 작업구분/세부단계에 맞춰 다시 채운다(연동 드롭다운).
function populateCloudCatFilter() {
  let base = menuFilteredRecords();
  if (cloudWorkTypeFilter.value) {
    base = base.filter((r) => recordInWorkTypeFolder(r, cloudWorkTypeFilter.value));
  }
  if (cloudPhaseFilter.value) {
    base = base.filter((r) => r.work_type === cloudPhaseFilter.value);
  }
  const values = [...new Set(base.map((r) => r.cat).filter(Boolean))].sort();
  populateSelectOptions(cloudCatFilter, values);
}

// 날짜 드롭다운은 선택된 작업구분/세부단계/최하위 폴더에 맞춰 다시 채운다(연동 드롭다운). 최신 날짜가 위로 오게 내림차순.
function populateCloudDateFilter() {
  let base = menuFilteredRecords();
  if (cloudWorkTypeFilter.value) {
    base = base.filter((r) => recordInWorkTypeFolder(r, cloudWorkTypeFilter.value));
  }
  if (cloudPhaseFilter.value) {
    base = base.filter((r) => r.work_type === cloudPhaseFilter.value);
  }
  if (cloudCatFilter.value) {
    base = base.filter((r) => r.cat === cloudCatFilter.value);
  }
  const values = [...new Set(base.map((r) => r.date).filter(Boolean))].sort().reverse();
  populateSelectOptions(cloudDateFilter, values);
}

function updateCloudMenuNotice() {
  const selectedMenu = workTitleInput.value;
  if (!selectedMenu) {
    cloudMenuNotice.textContent = "";
    return;
  }
  const tagged = cloudRecords.filter((r) => r.menu === selectedMenu).length;
  if (tagged === 0) {
    cloudMenuNotice.textContent = `"${selectedMenu}" 구분으로 태그된 사진이 아직 없습니다. work-shoot에서 "${selectedMenu}" 메뉴로 새로 촬영한 사진부터 여기 나타납니다. (구분 미지정 사진은 설정에서 "선택 안 함"으로 두면 볼 수 있습니다)`;
  } else {
    cloudMenuNotice.textContent = `"${selectedMenu}" 구분 사진 ${tagged}장을 보여줍니다.`;
  }
}

function filteredCloudRecords() {
  const q = cloudSearch.value.trim().toLowerCase();
  let filtered = menuFilteredRecords();
  if (cloudWorkTypeFilter.value) {
    filtered = filtered.filter((r) => recordInWorkTypeFolder(r, cloudWorkTypeFilter.value));
  }
  if (cloudPhaseFilter.value) {
    filtered = filtered.filter((r) => r.work_type === cloudPhaseFilter.value);
  }
  if (cloudCatFilter.value) {
    filtered = filtered.filter((r) => r.cat === cloudCatFilter.value);
  }
  if (cloudDateFilter.value) {
    filtered = filtered.filter((r) => r.date === cloudDateFilter.value);
  }
  if (q) {
    filtered = filtered.filter((r) =>
      [r.tag, r.loc, r.note, r.cat, r.work_type].some((v) => (v || "").toLowerCase().includes(q))
    );
  }
  return filtered;
}

function renderCloudList() {
  const filtered = filteredCloudRecords();
  cloudList.innerHTML = "";
  filtered.forEach((r) => {
    const row = document.createElement("label");
    row.className = "cloud-item";
    const catText = r.cat ? ` · ${r.cat}` : "";
    const menuTag = r.menu ? "" : " (구분 미지정)";
    row.innerHTML = `
      <input type="checkbox">
      <img src="${r.photo_url}" loading="lazy">
      <div class="cloud-meta">
        <div class="cloud-primary">${r.tag || "(기기번호 없음)"} · ${r.loc || ""}${catText}</div>
        <div class="cloud-secondary">${r.date || ""} ${noteContentOf(r)}${menuTag}</div>
      </div>
    `;
    // 서버에 파일이 없어 썸네일이 안 뜨는 사진은 목록에서부터 미리 표시해서, 고르기 전에 알 수 있게 한다.
    const img = row.querySelector("img");
    img.addEventListener("error", () => {
      row.classList.add("cloud-item-broken");
      img.replaceWith(Object.assign(document.createElement("div"), { className: "cloud-item-broken-icon", textContent: "이미지 없음" }));
    });
    const checkbox = row.querySelector("input");
    checkbox.checked = cloudSelected.has(r.photo_url);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) cloudSelected.add(r.photo_url);
      else cloudSelected.delete(r.photo_url);
      updateCloudSelectedCount();
    });
    cloudList.appendChild(row);
  });
  updateCloudSelectedCount();
}

async function loadCloudRecords() {
  if (!sbClient) {
    cloudStatus.textContent = "Supabase 연결 실패";
    return;
  }
  cloudStatus.textContent = "불러오는 중...";
  try {
    const { data, error } = await sbClient
      .from("work_photos")
      .select("*")
      .order("date", { ascending: false })
      .limit(5000);
    if (error) throw error;
    cloudRecords = (data || []).filter((r) => r.photo_url);
    cloudStatus.textContent = `총 ${cloudRecords.length}장`;
    updateCloudMenuNotice();
    populateCloudWorkTypeFilter();
    populateCloudPhaseFilter();
    populateCloudCatFilter();
    populateCloudDateFilter();
    renderCloudList();
  } catch (e) {
    console.error(e);
    cloudStatus.textContent = "불러오기 실패: " + e.message;
  }
}

document.getElementById("openCloudPicker").addEventListener("click", () => {
  cloudModal.style.display = "flex";
  cloudSelected.clear();
  cloudSearch.value = "";
  cloudWorkTypeFilter.value = "";
  cloudPhaseFilter.value = "";
  cloudCatFilter.value = "";
  cloudDateFilter.value = "";
  loadCloudRecords();
});
document.getElementById("closeCloudPicker").addEventListener("click", () => {
  cloudModal.style.display = "none";
});
cloudSearch.addEventListener("input", renderCloudList);
cloudWorkTypeFilter.addEventListener("change", () => {
  populateCloudPhaseFilter();
  populateCloudCatFilter();
  populateCloudDateFilter();
  renderCloudList();
});
cloudPhaseFilter.addEventListener("change", () => {
  populateCloudCatFilter();
  populateCloudDateFilter();
  renderCloudList();
});
cloudCatFilter.addEventListener("change", () => {
  populateCloudDateFilter();
  renderCloudList();
});
cloudDateFilter.addEventListener("change", renderCloudList);
cloudSelectAllBtn.addEventListener("click", () => {
  const filtered = filteredCloudRecords();
  const allSelected = filtered.length > 0 && filtered.every((r) => cloudSelected.has(r.photo_url));
  filtered.forEach((r) => {
    if (allSelected) cloudSelected.delete(r.photo_url);
    else cloudSelected.add(r.photo_url);
  });
  renderCloudList();
});

const cloudLayoutSelect = document.getElementById("cloudLayout");

importCloudBtn.addEventListener("click", async () => {
  const chosen = cloudRecords.filter((r) => cloudSelected.has(r.photo_url));
  if (chosen.length === 0) {
    alert("불러올 사진을 선택해주세요.");
    return;
  }
  const layout = cloudLayoutSelect.value;
  const perPage = setsCountFor(layout);
  importCloudBtn.disabled = true;
  const statusEl = document.getElementById("status");
  // 서버에 사진 파일이 실제로 없는 등, 일부 사진만 못 불러와도 나머지는 정상적으로 불러오도록
  // 사진 하나씩 개별 실패를 흡수한다 — 예전엔 1장만 실패해도 선택한 사진 전체가 통째로 취소됐다.
  const okSets = [];
  const failed = [];
  try {
    for (let i = 0; i < chosen.length; i++) {
      importCloudBtn.textContent = `불러오는 중 (${i + 1}/${chosen.length})...`;
      const rec = chosen[i];
      try {
        okSets.push(await cloudRecordToSet(rec));
      } catch (e) {
        console.error("사진 불러오기 실패:", rec.photo_url, e);
        failed.push(rec);
      }
    }
    const pageGroups = [];
    for (let i = 0; i < okSets.length; i += perPage) {
      const group = okSets.slice(i, i + perPage);
      while (group.length < perPage) group.push(emptySet());
      pageGroups.push({ layout, sets: group });
    }
    if (pageGroups.length > 0) {
      clearLeadingEmptyPage();
      pageGroups.forEach((g) => addPage(g));
    }
    cloudModal.style.display = "none";
    let doneMsg = `사진 ${okSets.length}개가 불러오기 완료되었습니다. (페이지 ${pageGroups.length}개 생성)`;
    if (failed.length > 0) {
      const failedTags = failed.map((r) => r.tag || "(기기번호 없음)").join(", ");
      doneMsg += `\n\n⚠️ ${failed.length}장은 서버에 이미지 파일이 없어 불러오지 못했습니다: ${failedTags}`;
    }
    statusEl.textContent = `사진 ${okSets.length}개 불러오기 완료${failed.length ? ` (실패 ${failed.length}개)` : ""}`;
    alert(doneMsg);
  } catch (e) {
    console.error(e);
    alert("불러오기 실패: " + e.message);
  } finally {
    importCloudBtn.disabled = false;
    importCloudBtn.textContent = "선택한 사진 불러오기";
  }
});

// ── PC 폴더에서 불러오기 (로컬 파일 선택) ──────────────────────
// 클라우드 레코드 대신 로컬 File 객체를 세트로 변환한다. 기기번호/작업구역/날짜는
// 정보가 없으므로 빈 값으로 두고, 작업내용만 파일명/EXIF로 자동 추정한다.
async function localFileToSet(file) {
  const content = (await deriveContentForFile(file)) || "";
  return { dwg: "", location: "", content, date: "", photo: file };
}

// 선택한 사진들을 위 레이아웃 선택(2/4장)에 맞춰 묶어서 페이지로 만든다. 갤러리 불러오기와 동일한 방식.
async function importLocalFilesGrouped(files) {
  if (!files || files.length === 0) return;
  const layout = cloudLayoutSelect.value;
  const perPage = setsCountFor(layout);
  const statusEl = document.getElementById("status");
  const btn = document.getElementById("openLocalPicker");
  btn.disabled = true;
  try {
    const pageGroups = [];
    for (let i = 0; i < files.length; i += perPage) {
      btn.textContent = `불러오는 중 (${Math.min(i + perPage, files.length)}/${files.length})...`;
      const group = files.slice(i, i + perPage);
      const sets = [];
      for (const f of group) sets.push(await localFileToSet(f));
      while (sets.length < perPage) sets.push(emptySet());
      pageGroups.push({ layout, sets });
    }
    clearLeadingEmptyPage();
    pageGroups.forEach((g) => addPage(g));
    statusEl.textContent = `사진 ${files.length}개가 불러오기 완료되었습니다. (페이지 ${pageGroups.length}개 생성)`;
  } catch (e) {
    console.error(e);
    alert("불러오기 실패: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "💻 PC에서 선택 불러오기";
  }
}

// 선택한 사진 각각을 별도 페이지로 만든다(사진 1장 = 페이지 1개, 나머지 슬롯은 비움).
async function importLocalFilesIndividually(files) {
  if (!files || files.length === 0) return;
  const layout = cloudLayoutSelect.value;
  const perPage = setsCountFor(layout);
  const statusEl = document.getElementById("status");
  const btn = document.getElementById("openLocalIndividualPicker");
  btn.disabled = true;
  try {
    clearLeadingEmptyPage();
    for (let i = 0; i < files.length; i++) {
      btn.textContent = `불러오는 중 (${i + 1}/${files.length})...`;
      const sets = [await localFileToSet(files[i])];
      while (sets.length < perPage) sets.push(emptySet());
      addPage({ layout, sets });
    }
    statusEl.textContent = `사진 ${files.length}개가 개별 페이지로 불러오기 완료되었습니다. (페이지 ${files.length}개 생성)`;
  } catch (e) {
    console.error(e);
    alert("불러오기 실패: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📄 개별 불러오기";
  }
}

const localPickerInput = document.getElementById("localPickerInput");
document.getElementById("openLocalPicker").addEventListener("click", () => localPickerInput.click());
localPickerInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  await importLocalFilesGrouped(files);
});

const localIndividualPickerInput = document.getElementById("localIndividualPickerInput");
document.getElementById("openLocalIndividualPicker").addEventListener("click", () => localIndividualPickerInput.click());
localIndividualPickerInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  await importLocalFilesIndividually(files);
});

document.getElementById("toggleSettings").addEventListener("click", () => {
  const body = document.getElementById("settingsBody");
  body.style.display = body.style.display === "none" ? "block" : "none";
});

const projectNameInput = document.getElementById("projectName");
const companyNameInput = document.getElementById("companyName");
const workTitleInput = document.getElementById("workTitle");

function updateHdrProjectCompany() {
  const t = [projectNameInput.value, companyNameInput.value].filter(Boolean).join(" · ");
  const el = document.getElementById("hdrProjectCompany");
  el.textContent = t;
  el.style.display = t ? "" : "none";
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  const data = await res.json();
  projectNameInput.value = data.project_name || "";
  companyNameInput.value = data.company_name || "";
  workTitleInput.value = data.work_title || "";
  updateHdrProjectCompany();
}

async function saveSettings() {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: projectNameInput.value,
      company_name: companyNameInput.value,
      work_title: workTitleInput.value,
    }),
  });
  updateHdrProjectCompany();
}

projectNameInput.addEventListener("blur", saveSettings);
companyNameInput.addEventListener("blur", saveSettings);
workTitleInput.addEventListener("change", saveSettings);

function buildFormData(format) {
  const formData = new FormData();
  formData.append("format", format);
  formData.append(
    "settings",
    JSON.stringify({
      project_name: projectNameInput.value,
      company_name: companyNameInput.value,
      work_title: workTitleInput.value,
    })
  );

  const meta = pages.map((state, i) => {
    const pageMeta = { layout: state.layout, sets: [] };
    state.sets.forEach((s, j) => {
      let photo_key = null;
      if (s.photo) {
        photo_key = `p${i}_s${j}`;
        formData.append(photo_key, s.photo);
      }
      pageMeta.sets.push({
        dwg: s.dwg,
        location: s.location,
        content: s.content,
        date: s.date,
        photo_key,
      });
    });
    return pageMeta;
  });
  formData.append("pages", JSON.stringify(meta));
  return formData;
}

function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : fallback;
}

// ── 저장 폴더 (File System Access API) — 한 번 지정하면 이후 다운로드는 같은 폴더에 바로 저장 ──
let saveDirHandle = null;
const folderStatusEl = document.getElementById("folderStatus");
const pickFolderBtn = document.getElementById("pickFolderBtn");
const supportsFsAccess = !!window.showDirectoryPicker;

function openWorkLogDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("WorkLogDB", 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "key" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadSavedFolderHandle() {
  if (!supportsFsAccess) return;
  try {
    const db = await openWorkLogDb();
    const req = db.transaction("settings", "readonly").objectStore("settings").get("folderHandle");
    const rec = await new Promise((res) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });
    if (rec && rec.value) {
      saveDirHandle = rec.value;
      updateFolderStatusUI();
    }
  } catch (e) {
    console.warn("저장 폴더 정보 불러오기 실패", e);
  }
}

async function persistFolderHandle(handle) {
  try {
    const db = await openWorkLogDb();
    db.transaction("settings", "readwrite").objectStore("settings").put({ key: "folderHandle", value: handle });
  } catch (e) {
    console.warn("저장 폴더 정보 저장 실패", e);
  }
}

function updateFolderStatusUI() {
  if (!folderStatusEl) return;
  folderStatusEl.textContent = saveDirHandle
    ? `✅ 저장 폴더: ${saveDirHandle.name}`
    : "⚠️ 저장 폴더가 지정되지 않았습니다.";
  if (pickFolderBtn) pickFolderBtn.textContent = saveDirHandle ? "폴더 변경" : "폴더 지정";
  const panel = document.getElementById("folderPanel");
  if (panel) panel.classList.toggle("folder-set", !!saveDirHandle);
}

async function ensureFolderPermission(handle) {
  try {
    const result = await handle.requestPermission({ mode: "readwrite" });
    return result === "granted";
  } catch (e) {
    return false;
  }
}

async function pickFolder() {
  if (!supportsFsAccess) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    saveDirHandle = handle;
    persistFolderHandle(handle);
    updateFolderStatusUI();
    return handle;
  } catch (e) {
    if (e.name !== "AbortError") alert("폴더 선택 실패: " + e.message);
    return null;
  }
}

if (pickFolderBtn) pickFolderBtn.addEventListener("click", pickFolder);

async function download(format) {
  const statusEl = document.getElementById("status");
  if (pages.length === 0) {
    statusEl.textContent = "페이지를 1개 이상 추가해주세요.";
    return;
  }

  if (supportsFsAccess) {
    if (!saveDirHandle) {
      alert("먼저 저장할 폴더를 지정해주세요.");
      const picked = await pickFolder();
      if (!picked) {
        statusEl.textContent = "폴더 지정이 취소되어 다운로드를 진행하지 않았습니다.";
        return;
      }
    }
    const allowed = await ensureFolderPermission(saveDirHandle);
    if (!allowed) {
      statusEl.textContent = "폴더 접근 권한이 없습니다. \"폴더 변경\"으로 다시 지정해주세요.";
      return;
    }
  }

  statusEl.textContent = "생성 중...";
  const pageCount = pages.length;
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      body: buildFormData(format),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const filename = filenameFromDisposition(
      res.headers.get("Content-Disposition"),
      format === "xlsx" ? "사진대지.xlsx" : "사진대지.pdf"
    );

    if (supportsFsAccess && saveDirHandle) {
      const fileHandle = await saveDirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      statusEl.textContent = `저장 완료: ${saveDirHandle.name}/${filename}`;
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      statusEl.textContent = `다운로드 완료: ${filename}`;
    }

    const resetConfirmed = confirm(
      `${pageCount}페이지가 다운로드 되었습니다. ("${filename}")\n\n새 작업을 위해 화면을 초기화할까요?\n(공사명/사진관리 구분은 유지됩니다)`
    );
    if (resetConfirmed) resetApp();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "생성 실패: " + e.message;
  }
}

// 다운로드 확인 후 "초기화": 페이지 목록만 비우고 새 빈 페이지 1개로 되돌린다. 공사명/구분 설정은 유지.
function resetApp() {
  pages.length = 0;
  pagesEl.innerHTML = "";
  addPage();
  document.getElementById("status").textContent = "초기화되었습니다. 새 페이지를 추가하거나 갤러리에서 불러오세요.";
}

async function preview() {
  const statusEl = document.getElementById("status");
  if (pages.length === 0) {
    statusEl.textContent = "페이지를 1개 이상 추가해주세요.";
    return;
  }
  // 팝업 차단 방지를 위해 클릭 이벤트 안에서(비동기 fetch 전) 먼저 빈 탭을 연다.
  const previewWindow = window.open("", "_blank");
  statusEl.textContent = "미리보기 생성 중...";
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      body: buildFormData("pdf"),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (previewWindow) {
      // 일부 브라우저에서 팝업 창의 location을 blob: URL로 직접 이동시키는 것이 막히므로,
      // iframe으로 PDF를 감싼 문서를 직접 써서 안정적으로 표시한다.
      previewWindow.document.write(
        `<!DOCTYPE html><html><head><title>미리보기</title><style>html,body{margin:0;height:100%;}iframe{width:100%;height:100%;border:none;}</style></head><body><iframe src="${url}"></iframe></body></html>`
      );
      previewWindow.document.close();
    } else {
      window.open(url, "_blank");
    }
    statusEl.textContent = "미리보기 완료";
  } catch (e) {
    console.error(e);
    if (previewWindow) previewWindow.close();
    statusEl.textContent = "미리보기 실패: " + e.message;
  }
}

document.getElementById("previewBtn").addEventListener("click", preview);
document.getElementById("downloadXlsx").addEventListener("click", () => download("xlsx"));
document.getElementById("downloadPdf").addEventListener("click", () => download("pdf"));

loadSettings();
loadSavedFolderHandle();
addPage();
