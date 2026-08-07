export function mapMenu(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeName: row.store_name,
    items: row.items || [],
    image: row.image || null,
    storePhone: row.store_phone || null,
    storeType: row.store_type || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMenuSummary(row) {
  return {
    id: row.id,
    storeName: row.store_name,
    itemCount: Array.isArray(row.items) ? row.items.length : 0,
    storeType: row.store_type || null,
    createdAt: row.created_at,
  };
}

export function mapGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    menuId: row.menu_id,
    storeName: row.store_name,
    groupName: row.group_name,
    creatorName: row.creator_name,
    payerName: row.payer_name,
    payerContact: row.payer_contact,
    payerQrImage: row.payer_qr_image,
    status: row.status,
    memberOrders: row.member_orders || {},
    paidStatus: row.paid_status || {},
    extraCharges: row.extra_charges || [],
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export function mapGroupSummary(row) {
  return {
    id: row.id,
    storeName: row.store_name,
    groupName: row.group_name,
    creatorName: row.creator_name,
    payerName: row.payer_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function mapPaymentProfile(row) {
  if (!row) return null;
  return {
    name: row.name,
    contact: row.contact,
    qrImage: row.qr_image,
    lineUrl: row.line_url || null,
    updatedAt: row.updated_at,
  };
}
