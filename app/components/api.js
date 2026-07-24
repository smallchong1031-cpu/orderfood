async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = null;
    }
  }
  if (!res.ok) {
    throw new Error((body && body.error) || `請求失敗 (${res.status})`);
  }
  return body;
}

export const api = {
  listMenus: () => request("/menus"),
  getMenu: (id) => request(`/menus/${id}`),
  createMenu: (data) => request("/menus", { method: "POST", body: JSON.stringify(data) }),
  updateMenu: (id, data) => request(`/menus/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMenu: (id) => request(`/menus/${id}`, { method: "DELETE" }),
  recognizeMenu: (data) => request("/menus/recognize", { method: "POST", body: JSON.stringify(data) }),

  listGroups: () => request("/groups"),
  getGroup: (id) => request(`/groups/${id}`),
  createGroup: (data) => request("/groups", { method: "POST", body: JSON.stringify(data) }),
  deleteGroup: (id) => request(`/groups/${id}`, { method: "DELETE" }),
  submitOrder: (id, data) => request(`/groups/${id}/order`, { method: "POST", body: JSON.stringify(data) }),
  closeGroup: (id, data) => request(`/groups/${id}/close`, { method: "POST", body: JSON.stringify(data) }),
  updatePayerName: (id, data) => request(`/groups/${id}/payer`, { method: "PUT", body: JSON.stringify(data) }),
  togglePaid: (id, data) => request(`/groups/${id}/paid`, { method: "POST", body: JSON.stringify(data) }),

  getPaymentProfile: (name) => request(`/payment-profile/${encodeURIComponent(name)}`),
  savePaymentProfile: (name, data) =>
    request(`/payment-profile/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePaymentProfile: (name) => request(`/payment-profile/${encodeURIComponent(name)}`, { method: "DELETE" }),
};
