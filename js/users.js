(() => {
  let allUsers = [];

  const ROLE_LABEL = { ADMIN: '관리자', MANAGER: '매니저', USER: '일반사용자' };
  const ROLE_CLASS  = { ADMIN: 'admin',  MANAGER: 'manager',  USER: 'user' };

  const tbody         = $('#userTableBody');
  const tableCount    = $('#userTableCount');
  const countTotal    = $('#userCountTotal');
  const countActive   = $('#userCountActive');
  const countDisabled = $('#userCountDisabled');
  const countAdmin    = $('#userCountAdmin');
  const recentLogin   = $('#userRecentLogin');
  const searchInput   = $('#userSearch');
  const filterRole    = $('#filterRole');
  const filterStatus  = $('#filterStatus');
  const filterResetBtn    = $('#filterResetBtn');
  const loginHistoryBody  = $('#loginHistoryBody');

  function fmtDatetime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
         + `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function updateSummary(users) {
    const active   = users.filter((u) => (u.status ?? '').toUpperCase() === 'ACTIVE').length;
    const disabled = users.filter((u) => (u.status ?? '').toUpperCase() === 'DISABLED').length;
    const admin    = users.filter((u) => (u.role   ?? '').toUpperCase() === 'ADMIN').length;

    if (countTotal)    countTotal.textContent    = users.length;
    if (countActive)   countActive.textContent   = active;
    if (countDisabled) countDisabled.textContent = disabled;
    if (countAdmin)    countAdmin.textContent    = admin;

    if (recentLogin) {
      const latest = [...users]
        .filter((u) => u.lastLoginAt)
        .sort((a, b) => new Date(b.lastLoginAt) - new Date(a.lastLoginAt))[0];
      recentLogin.textContent = latest
        ? `${latest.username} / ${fmtDatetime(latest.lastLoginAt)}`
        : '—';
    }
  }

  function renderTable(users) {
    const query  = (searchInput?.value  ?? '').trim().toLowerCase();
    const role   = filterRole?.value   ?? '';
    const status = filterStatus?.value ?? '';

    const filtered = users.filter((u) => {
      if (role   && (u.role   ?? '').toUpperCase() !== role)   return false;
      if (status && (u.status ?? '').toUpperCase() !== status) return false;
      if (query) {
        const hay = `${u.username} ${u.displayName} ${u.description ?? ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    if (tableCount) tableCount.textContent = `총 ${filtered.length}명`;
    if (!tbody) return;

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" style="text-align:center;color:#5a6b7e;padding:32px 0">검색 결과가 없습니다.</td>`;
      tbody.appendChild(tr);
      return;
    }

    filtered.forEach((u) => {
      const role      = (u.role ?? '').toUpperCase();
      const roleLabel = ROLE_LABEL[role] ?? u.role;
      const roleCls   = ROLE_CLASS[role] ?? 'user';
      const statusCls = (u.status ?? '').toLowerCase();

      const tr = document.createElement('tr');
      tr.dataset.username = u.username;

      tr.innerHTML = `
        <td><span class="account-status ${statusCls}">${(u.status ?? '').toUpperCase()}</span></td>
        <td class="mono">${u.username}</td>
        <td>${u.displayName || '—'}</td>
        <td><span class="role-badge ${roleCls}">${roleLabel}</span></td>
        <td>${u.description || '—'}</td>
        <td>${fmtDatetime(u.lastLoginAt)}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  async function loadUsers() {
    try {
      const res = await apiFetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allUsers = data.users ?? [];
      updateSummary(allUsers);
      renderTable(allUsers);
    } catch (err) {
      console.error('users fetch error:', err);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ff5d62;padding:32px 0">데이터를 불러오지 못했습니다.</td></tr>`;
      }
    }
  }

  searchInput?.addEventListener('input',  () => renderTable(allUsers));
  filterRole?.addEventListener('change',  () => renderTable(allUsers));
  filterStatus?.addEventListener('change', () => renderTable(allUsers));

  filterResetBtn?.addEventListener('click', () => {
    if (searchInput)  searchInput.value  = '';
    if (filterRole)   filterRole.value   = '';
    if (filterStatus) filterStatus.value = '';
    renderTable(allUsers);
  });

  loadUsers();
  loadLoginHistory();

  // ── 로그인 이력 ──────────────────────────────────────────────────────────────
  async function loadLoginHistory() {
    if (!loginHistoryBody) return;
    try {
      const res = await apiFetch('/api/users/login-history?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = data.history ?? [];

      loginHistoryBody.innerHTML = '';

      if (list.length === 0) {
        loginHistoryBody.innerHTML =
          `<tr><td colspan="4" style="text-align:center;color:#5a6b7e;padding:24px 0">이력이 없습니다.</td></tr>`;
        return;
      }

      list.forEach((h) => {
        const isSuccess = (h.result ?? '').toLowerCase() === 'success';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono" style="white-space:nowrap">${fmtDatetime(h.timestamp)}</td>
          <td class="mono">${h.username ?? '—'}</td>
          <td class="login-result ${isSuccess ? 'success' : 'fail'}">${h.result ?? '—'}</td>
          <td class="mono">${h.ip ?? '—'}</td>
        `;
        loginHistoryBody.appendChild(tr);
      });
    } catch (err) {
      console.error('login-history fetch error:', err);
      loginHistoryBody.innerHTML =
        `<tr><td colspan="4" style="text-align:center;color:#ff5d62;padding:24px 0">이력을 불러오지 못했습니다.</td></tr>`;
    }
  }

  // ── 선택 사용자 상세 패널 ────────────────────────────────────────────────────
  let selectedUsername = null;
  let originalStatus   = null;

  const detailForm        = $('#detailForm');
  const detailUsername    = $('#detailUsername');
  const detailDisplayName = $('#detailDisplayName');
  const detailRole        = $('#detailRole');
  const detailStatus      = $('#detailStatus');
  const detailDescription = $('#detailDescription');
  const detailFormMsg     = $('#detailFormMsg');
  const detailSaveBtn     = $('#detailSaveBtn');
  const detailResetPwBtn  = $('#detailResetPwBtn');
  const detailDeleteBtn   = $('#detailDeleteBtn');

  function showDetailMsg(msg, isError = true) {
    if (!detailFormMsg) return;
    detailFormMsg.textContent = msg;
    detailFormMsg.style.color = isError ? '#ff5d62' : '#4cd96b';
    detailFormMsg.hidden = false;
  }

  function fillDetailPanel(user) {
    selectedUsername = user.username;
    originalStatus   = (user.status ?? '').toUpperCase();
    if (detailFormMsg) detailFormMsg.hidden = true;

    if (detailUsername)    detailUsername.value    = user.username;
    if (detailDisplayName) detailDisplayName.value = user.displayName ?? '';
    if (detailRole)        detailRole.value        = (user.role ?? 'USER').toUpperCase();
    if (detailStatus)      detailStatus.value      = originalStatus;
    if (detailDescription) detailDescription.value = user.description ?? '';
  }

  tbody?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-username]');
    if (!tr) return;
    $$('tr.selected-row', tbody).forEach((r) => r.classList.remove('selected-row'));
    tr.classList.add('selected-row');
    const user = allUsers.find((u) => u.username === tr.dataset.username);
    if (user) fillDetailPanel(user);
  });

  detailSaveBtn?.addEventListener('click', async () => {
    if (!selectedUsername) return;
    if (detailFormMsg) detailFormMsg.hidden = true;
    detailSaveBtn.disabled = true;

    try {
      const enc       = encodeURIComponent(selectedUsername);
      const newStatus = (detailStatus?.value ?? '').toUpperCase();
      const calls     = [];

      // 기본 정보 (이름/권한/설명)
      calls.push(
        apiFetch(`/api/users/${enc}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: detailDisplayName?.value.trim() ?? '',
            role:        (detailRole?.value ?? 'USER').toLowerCase(),
            description: detailDescription?.value.trim() ?? '',
          }),
        })
      );

      // 상태 변경 (ACTIVE / DISABLED / LOCKED 모두 PUT /status로 처리)
      if (newStatus !== originalStatus) {
        calls.push(
          apiFetch(`/api/users/${enc}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus.toLowerCase() }),
          })
        );
      }

      const results = await Promise.all(calls);
      const failed  = results.find((r) => !r.ok);

      if (failed) {
        const data = await failed.json().catch(() => ({}));
        showDetailMsg(data.error ?? `저장 실패 (${failed.status})`);
      } else {
        showDetailMsg('저장되었습니다.', false);
        await loadUsers();
        const updated = allUsers.find((u) => u.username === selectedUsername);
        if (updated) fillDetailPanel(updated);
        const row = $(`tr[data-username="${selectedUsername}"]`, tbody);
        row?.classList.add('selected-row');
      }
    } catch {
      showDetailMsg('네트워크 오류가 발생했습니다.');
    } finally {
      detailSaveBtn.disabled = false;
    }
  });

  detailResetPwBtn?.addEventListener('click', async () => {
    if (!selectedUsername) return;
    if (detailFormMsg) detailFormMsg.hidden = true;
    detailResetPwBtn.disabled = true;

    try {
      const res = await apiFetch(
        `/api/users/${encodeURIComponent(selectedUsername)}/password`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: '00000000' }),
        }
      );
      if (res.ok) {
        showDetailMsg('비밀번호가 초기화되었습니다.', false);
      } else {
        const data = await res.json().catch(() => ({}));
        showDetailMsg(data.error ?? `초기화 실패 (${res.status})`);
      }
    } catch {
      showDetailMsg('네트워크 오류가 발생했습니다.');
    } finally {
      detailResetPwBtn.disabled = false;
    }
  });

  detailDeleteBtn?.addEventListener('click', async () => {
    if (!selectedUsername) return;
    if (!confirm(`'${selectedUsername}' 사용자를 삭제하시겠습니까?`)) return;
    if (detailFormMsg) detailFormMsg.hidden = true;
    detailDeleteBtn.disabled = true;

    try {
      const res = await apiFetch(
        `/api/users/${encodeURIComponent(selectedUsername)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        selectedUsername = null;
        originalStatus   = null;
        if (detailForm) detailForm.hidden = true;
        await loadUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        showDetailMsg(data.error ?? `삭제 실패 (${res.status})`);
        detailDeleteBtn.disabled = false;
      }
    } catch {
      showDetailMsg('네트워크 오류가 발생했습니다.');
      detailDeleteBtn.disabled = false;
    }
  });

  // ── 사용자 추가 모달 ─────────────────────────────────────────────────────────
  const addUserModal    = $('#addUserModal');
  const nuUsername      = $('#nuUsername');
  const nuDisplayName   = $('#nuDisplayName');
  const nuPassword      = $('#nuPassword');
  const nuRole          = $('#nuRole');
  const nuDescription   = $('#nuDescription');
  const nuFormMsg       = $('#nuFormMsg');
  const nuSubmitBtn     = $('#nuSubmitBtn');

  function openAddModal() {
    resetAddForm();
    if (addUserModal) addUserModal.hidden = false;
  }

  function closeAddModal() {
    if (addUserModal) addUserModal.hidden = true;
  }

  function resetAddForm() {
    if (nuUsername)    nuUsername.value    = '';
    if (nuDisplayName) nuDisplayName.value = '';
    if (nuPassword)    nuPassword.value    = '';
    if (nuRole)        nuRole.value        = 'USER';
    if (nuDescription) nuDescription.value = '';
    if (nuFormMsg) { nuFormMsg.textContent = ''; nuFormMsg.hidden = true; }
    if (nuSubmitBtn) nuSubmitBtn.disabled = false;
  }

  function showFormMsg(msg) {
    if (!nuFormMsg) return;
    nuFormMsg.textContent = msg;
    nuFormMsg.hidden = false;
  }

  async function submitAddUser() {
    const username    = nuUsername?.value.trim()    ?? '';
    const displayName = nuDisplayName?.value.trim() ?? '';
    const password    = nuPassword?.value           ?? '';
    const role        = nuRole?.value               ?? 'USER';
    const description = nuDescription?.value.trim() ?? '';

    if (!username) { showFormMsg('사용자 ID를 입력하세요.'); return; }
    if (!password) { showFormMsg('비밀번호를 입력하세요.'); return; }
    if (password.length < 8) { showFormMsg('비밀번호는 8자 이상이어야 합니다.'); return; }

    if (nuSubmitBtn) nuSubmitBtn.disabled = true;
    if (nuFormMsg)   nuFormMsg.hidden = true;

    try {
      const body = { username, password, role: role.toLowerCase() };
      if (displayName) body.displayName = displayName;
      if (description) body.description = description;

      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        closeAddModal();
        await loadUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        showFormMsg(data.message ?? `오류가 발생했습니다. (${res.status})`);
        if (nuSubmitBtn) nuSubmitBtn.disabled = false;
      }
    } catch (err) {
      showFormMsg('네트워크 오류가 발생했습니다.');
      if (nuSubmitBtn) nuSubmitBtn.disabled = false;
    }
  }

  $('#clearHistoryBtn')?.addEventListener('click', async () => {
    if (!confirm('로그인 이력 전체를 삭제하시겠습니까?')) return;
    try {
      const res = await apiFetch('/api/users/login-history', { method: 'DELETE' });

      console.log('Clear history response:', res);
      
      if (res.ok) {
        await loadLoginHistory();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? `삭제 실패 (${res.status})`);
      }
    } catch {
      alert('네트워크 오류가 발생했습니다.');
    }
  });

  $('#addUserBtn')?.addEventListener('click', openAddModal);
  $('#addUserModalClose')?.addEventListener('click', closeAddModal);
  $('#nuCancelBtn')?.addEventListener('click', closeAddModal);
  $('#nuSubmitBtn')?.addEventListener('click', submitAddUser);

  // ── 로그인 보안 정책 ─────────────────────────────────────────────────────────
  const policyMaxFailed      = $('#policyMaxFailed');
  const policySessionTimeout = $('#policySessionTimeout');
  const policyMinPwLen       = $('#policyMinPwLen');
  const policyAutoLogout     = $('#policyAutoLogout');
  const policyMsg            = $('#policyMsg');
  const policySaveBtn        = $('#policySaveBtn');

  function showPolicyMsg(msg, isError = true) {
    if (!policyMsg) return;
    policyMsg.textContent  = msg;
    policyMsg.style.color  = isError ? '#ff5d62' : '#4cd96b';
    policyMsg.hidden       = false;
  }

  function setSelectValue(el, value) {
    if (!el) return;
    const str = String(value);
    const opt = [...el.options].find((o) => o.value === str);
    if (opt) el.value = str;
  }

  async function loadSecurityPolicy() {
    try {
      const res = await apiFetch('/api/users/security-policy');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setSelectValue(policyMaxFailed,      d.maxFailedAttempts);
      setSelectValue(policySessionTimeout, d.sessionTimeoutMinutes);
      setSelectValue(policyMinPwLen,       d.minPasswordLength);
      setSelectValue(policyAutoLogout,     d.autoLogout);
    } catch (err) {
      console.error('security-policy fetch error:', err);
    }
  }

  policySaveBtn?.addEventListener('click', async () => {
    if (policyMsg) policyMsg.hidden = true;
    policySaveBtn.disabled = true;
    try {
      const res = await apiFetch('/api/users/security-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxFailedAttempts:     parseInt(policyMaxFailed?.value      ?? '5',  10),
          sessionTimeoutMinutes: parseInt(policySessionTimeout?.value ?? '30', 10),
          minPasswordLength:     parseInt(policyMinPwLen?.value       ?? '8',  10),
          autoLogout:            (policyAutoLogout?.value ?? 'true') === 'true',
        }),
      });
      if (res.ok) {
        showPolicyMsg('저장되었습니다.', false);
      } else {
        const data = await res.json().catch(() => ({}));
        showPolicyMsg(data.error ?? `저장 실패 (${res.status})`);
      }
    } catch {
      showPolicyMsg('네트워크 오류가 발생했습니다.');
    } finally {
      policySaveBtn.disabled = false;
    }
  });

  loadSecurityPolicy();

})();
