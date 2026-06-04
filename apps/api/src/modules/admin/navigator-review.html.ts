/**
 * Review page HTML builder for the navigator hospital review portal.
 *
 * Served at GET /admin/navigator/review/:batchId?token=...
 * Self-contained: no external CSS/JS dependencies.
 */

import { ResearchTarget, HospitalDraft } from "./navigator-approve.service";

// Escape for HTML attribute values and text content
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Safe JSON embedding inside <script> tags (escapes </script> sequences)
function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function yesNo(v: boolean | null | undefined): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "—";
}

function confidenceBadge(c: HospitalDraft["confidence"]): string {
  const colors = { high: "#188038", medium: "#e37400", low: "#d93025" } as const;
  return `<span style="background:${colors[c]};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:bold;">${c.toUpperCase()}</span>`;
}

function buildCard(h: HospitalDraft, index: number): string {
  const depts = h.departments.map((d) => esc(d)).join(", ") || "—";
  const accreds = h.accreditation.map((a) => esc(a)).join(", ") || "None";
  const navNotes = h.navigation_notes.length
    ? h.navigation_notes.map((n) => `<li>${esc(n)}</li>`).join("")
    : "<li>—</li>";
  const doctors = h.key_doctors.length
    ? h.key_doctors.map((d) => `<li>${esc(d.name)} — <em>${esc(d.role)}</em></li>`).join("")
    : "<li>None listed</li>";

  // Pre-populated edit form values
  const doctorsText = esc(h.key_doctors.map((d) => `${d.name} | ${d.role}`).join("\n"));
  const navNotesText = esc(h.navigation_notes.join("\n"));

  return `
<div class="card" id="card-${esc(h.id)}">

  <!-- Read view -->
  <div id="read-${esc(h.id)}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div>
        <h3 style="margin:0 0 4px;color:#1a73e8;">${index}. ${esc(h.name)}</h3>
        <p style="margin:0 0 12px;color:#555;font-size:13px;">
          ${esc(h.short_name)} &nbsp;|&nbsp; ${esc(h.city)}, ${esc(h.state)}
          &nbsp;|&nbsp; Tier: <strong>${esc(h.tier ?? "—")}</strong>
          &nbsp;|&nbsp; ${confidenceBadge(h.confidence)}
        </p>
      </div>
      <button class="btn btn-edit" onclick="toggleEdit('${esc(h.id)}')">Edit</button>
    </div>
    <table class="fields">
      <tr><td>Type</td><td><strong>${esc(h.type)}</strong></td></tr>
      <tr><td>Accreditation</td><td>${accreds}</td></tr>
      <tr><td>Score</td><td><strong>${h.score ?? "—"}</strong></td></tr>
      <tr><td>NCG Member</td><td>${yesNo(h.ncg_member)}</td></tr>
      <tr><td>PMJAY Empanelled</td><td>${yesNo(h.pmjay_empanelled)}</td></tr>
      <tr><td>Cost Tier</td><td>${esc(h.cost_tier ?? "—")}</td></tr>
      <tr><td>Departments</td><td>${depts}</td></tr>
      <tr><td>Phone</td><td>${esc(h.contact.phone ?? "—")}</td></tr>
      <tr><td>Address</td><td>${esc(h.contact.address ?? "—")}</td></tr>
      ${h.contact.website ? `<tr><td>Website</td><td><a href="${esc(h.contact.website)}" target="_blank">${esc(h.contact.website)}</a></td></tr>` : ""}
    </table>
    <p style="font-size:13px;margin:0 0 4px;"><strong>Notes:</strong> ${esc(h.notes)}</p>
    <p style="font-size:13px;margin:0 0 4px;"><strong>Navigation notes:</strong></p>
    <ul style="margin:0 0 8px;padding-left:20px;font-size:13px;">${navNotes}</ul>
    <p style="font-size:13px;margin:0 0 4px;"><strong>Key doctors:</strong></p>
    <ul style="margin:0;padding-left:20px;font-size:13px;">${doctors}</ul>
  </div>

  <!-- Edit form (hidden by default) -->
  <div id="edit-${esc(h.id)}" class="edit-form">
    <h3 style="margin:0 0 16px;color:#1a73e8;">Editing: ${esc(h.name)}</h3>
    <div class="form-grid">
      <div class="fg">
        <label>Name</label>
        <input name="name" value="${esc(h.name)}">
      </div>
      <div class="fg">
        <label>Short Name</label>
        <input name="short_name" value="${esc(h.short_name)}">
      </div>
      <div class="fg">
        <label>Type</label>
        <input name="type" value="${esc(h.type)}" placeholder="Government / Private / Private (Govt-affiliated)">
      </div>
      <div class="fg">
        <label>Tier</label>
        <select name="tier">
          <option value="">—</option>
          ${["A", "B", "C", "D"].map((t) => `<option value="${t}"${h.tier === t ? " selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
      <div class="fg">
        <label>Score (0–100)</label>
        <input name="score" type="number" min="0" max="100" value="${esc(h.score ?? "")}">
      </div>
      <div class="fg">
        <label>Confidence</label>
        <select name="confidence">
          ${["high", "medium", "low"].map((c) => `<option value="${c}"${h.confidence === c ? " selected" : ""}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="fg">
        <label>Accreditation (comma-separated)</label>
        <input name="accreditation" value="${esc(h.accreditation.join(", "))}">
      </div>
      <div class="fg">
        <label>Departments (comma-separated)</label>
        <input name="departments" value="${esc(h.departments.join(", "))}">
      </div>
      <div class="fg">
        <label>Cost Tier</label>
        <input name="cost_tier" value="${esc(h.cost_tier ?? "")}">
      </div>
      <div class="fg">
        <label>Phone</label>
        <input name="phone" value="${esc(h.contact.phone ?? "")}">
      </div>
      <div class="fg wide">
        <label>Address</label>
        <input name="address" value="${esc(h.contact.address ?? "")}">
      </div>
      <div class="fg wide">
        <label>Website</label>
        <input name="website" type="url" value="${esc(h.contact.website ?? "")}">
      </div>
      <div class="fg wide">
        <label>Notes</label>
        <textarea name="notes" rows="3">${esc(h.notes)}</textarea>
      </div>
      <div class="fg wide">
        <label>Navigation Notes (one per line)</label>
        <textarea name="navigation_notes" rows="3">${navNotesText}</textarea>
      </div>
      <div class="fg wide">
        <label>Key Doctors (one per line: Name | Role)</label>
        <textarea name="key_doctors" rows="3">${doctorsText}</textarea>
      </div>
    </div>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center;">
      <button class="btn btn-save" onclick="saveHospital('${esc(h.id)}', this)">Save Changes</button>
      <button class="btn btn-cancel" onclick="cancelEdit('${esc(h.id)}')">Cancel</button>
      <span id="status-${esc(h.id)}" style="font-size:13px;"></span>
    </div>
  </div>

</div>`;
}

export function buildReviewHtml(batch: ResearchTarget, token: string): string {
  const cards = batch.hospitals
    .slice(0, 5)
    .map((h, i) => buildCard(h, i + 1))
    .join("\n");

  const created = new Date(batch.createdAt).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const statusColor: Record<string, string> = {
    researched: "#e37400",
    email_sent: "#1a73e8",
    approved: "#188038",
    rejected: "#d93025",
    pending: "#999",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Navigator Review — ${esc(batch.id)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#f1f3f4;margin:0;padding:16px}
    .container{max-width:760px;margin:0 auto}
    .card{background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px;margin:16px 0}
    .fields{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px}
    .fields td{padding:4px 8px}
    .fields tr:nth-child(even){background:#f8f9fa}
    .fields td:first-child{width:38%;color:#555}
    .btn{padding:8px 18px;border-radius:4px;border:none;cursor:pointer;font-size:14px;font-family:Arial,sans-serif}
    .btn-edit{background:#1a73e8;color:#fff}
    .btn-save{background:#188038;color:#fff}
    .btn-cancel{background:#e8eaed;color:#333}
    .btn-approve{background:#188038;color:#fff;padding:14px 36px;font-size:16px;border-radius:4px;border:none;cursor:pointer;font-family:Arial,sans-serif}
    .btn-approve:disabled{background:#aaa;cursor:default}
    .edit-form{display:none}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .fg label{display:block;font-size:12px;color:#555;margin-bottom:3px}
    .fg input,.fg select,.fg textarea{width:100%;padding:7px 8px;border:1px solid #dadce0;border-radius:4px;font-size:14px;font-family:Arial,sans-serif}
    .fg textarea{resize:vertical}
    .fg.wide{grid-column:1/-1}
    @media(max-width:540px){.form-grid{grid-template-columns:1fr}.fg.wide{grid-column:1}}
  </style>
</head>
<body>
<div class="container">

  <div class="card">
    <h2 style="margin:0 0 8px;color:#1a73e8;">Suchi Navigator — Hospital Review</h2>
    <p style="margin:0 0 4px;color:#555;font-size:14px;">
      <strong>Batch:</strong> ${esc(batch.id)} &nbsp;|&nbsp;
      <strong>Region:</strong> ${esc(batch.region)}
    </p>
    <p style="margin:0;color:#555;font-size:14px;">
      <strong>Hospitals:</strong> ${batch.hospitals.slice(0, 5).length} &nbsp;|&nbsp;
      <strong>Created:</strong> ${created} &nbsp;|&nbsp;
      <strong>Status:</strong>
      <span style="color:${statusColor[batch.status] ?? "#555"};font-weight:bold;">${esc(batch.status)}</span>
    </p>
  </div>

  ${cards}

  <div class="card" style="text-align:center;">
    <p style="font-size:15px;color:#333;margin:0 0 16px;">
      Edit any hospital above, then approve the batch to add all ${batch.hospitals.slice(0, 5).length} to the directory.
    </p>
    <div style="margin:0 auto 20px;max-width:320px;text-align:left;">
      <label for="approver-name" style="display:block;font-size:12px;color:#555;margin-bottom:4px;">Your name (for audit log)</label>
      <input id="approver-name" type="text" placeholder="e.g. Gautam" style="width:100%;padding:8px 10px;border:1px solid #dadce0;border-radius:4px;font-size:14px;font-family:Arial,sans-serif;">
    </div>
    <button class="btn btn-approve" id="approve-btn" onclick="approveAll()">
      Approve All — Add to Directory
    </button>
    <p style="margin:16px 0 0;font-size:12px;color:#888;">
      This link is valid for 7 days. Approving is irreversible.
    </p>
  </div>

</div>

<script>
  const BATCH_ID = ${safeJson(batch.id)};
  const TOKEN    = ${safeJson(token)};
  const API_BASE = window.location.origin + '/v1';

  function toggleEdit(id) {
    document.getElementById('read-' + id).style.display = 'none';
    document.getElementById('edit-' + id).style.display = 'block';
  }

  function cancelEdit(id) {
    document.getElementById('read-' + id).style.display = 'block';
    document.getElementById('edit-' + id).style.display = 'none';
    document.getElementById('status-' + id).textContent = '';
  }

  async function saveHospital(id, btn) {
    const form = document.getElementById('edit-' + id);
    const g = (name) => form.querySelector('[name=' + name + ']');
    const val = (name) => g(name) ? g(name).value.trim() : '';
    const splitComma = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
    const splitLine  = (s) => s.split('\\n').map(x => x.trim()).filter(Boolean);

    const scoreRaw = val('score');
    const updates = {
      name:             val('name'),
      short_name:       val('short_name'),
      type:             val('type'),
      tier:             val('tier') || null,
      score:            scoreRaw !== '' ? parseInt(scoreRaw, 10) : null,
      confidence:       val('confidence'),
      accreditation:    splitComma(val('accreditation')),
      departments:      splitComma(val('departments')),
      cost_tier:        val('cost_tier') || null,
      notes:            val('notes'),
      navigation_notes: splitLine(val('navigation_notes')),
      key_doctors:      splitLine(val('key_doctors')).map(line => {
        const [name, role] = line.split('|').map(s => s.trim());
        return { name: name || '', role: role || '' };
      }),
      contact: {
        phone:   val('phone') || null,
        address: val('address') || null,
        website: val('website') || null,
      },
    };

    const statusEl = document.getElementById('status-' + id);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    statusEl.textContent = '';

    try {
      const res = await fetch(
        API_BASE + '/admin/navigator/batch/' + BATCH_ID + '/hospital/' + id + '?token=' + TOKEN,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }
      );
      const data = await res.json();
      if (data.ok) {
        btn.textContent = 'Saved ✓';
        btn.style.background = '#188038';
        statusEl.style.color = '#188038';
        statusEl.textContent = 'Changes saved.';
        setTimeout(() => {
          btn.textContent = 'Save Changes';
          btn.style.background = '';
          btn.disabled = false;
        }, 2000);
      } else {
        btn.textContent = 'Save Changes';
        btn.disabled = false;
        statusEl.style.color = '#d93025';
        statusEl.textContent = 'Error: ' + (data.error || 'Unknown error');
      }
    } catch (e) {
      btn.textContent = 'Save Changes';
      btn.disabled = false;
      statusEl.style.color = '#d93025';
      statusEl.textContent = 'Network error — try again.';
    }
  }

  function approveAll() {
    const nameInput = document.getElementById('approver-name');
    const approverName = nameInput ? nameInput.value.trim() : '';
    let approveUrl = API_BASE + '/admin/navigator/approve/' + BATCH_ID + '?token=' + TOKEN;
    if (approverName) {
      approveUrl += '&approver=' + encodeURIComponent(approverName);
    }
    const btn = document.getElementById('approve-btn');
    btn.disabled = true;
    btn.textContent = 'Approving…';
    window.location.href = approveUrl;
  }
</script>
</body>
</html>`;
}
