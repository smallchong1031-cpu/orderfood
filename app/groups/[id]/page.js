import GroupOrderApp from "../../components/GroupOrderApp";
import { sql } from "@/lib/db";

// 讓分享揪團網址到 LINE 時，預覽卡片顯示的是店名與團名，而不是通用的「揪呷團」
export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const rows = await sql`select store_name, group_name, status from groups where id = ${id}`;
    if (rows.length > 0) {
      const { store_name: storeName, group_name: groupName, status } = rows[0];
      const statusText = status === "closed" ? "已結單" : "開團中";
      return {
        title: `${storeName}｜${groupName}`,
        description: `${statusText}・點進來一起點餐`,
        openGraph: {
          title: `${storeName}｜${groupName}`,
          description: `${statusText}・點進來一起點餐`,
        },
      };
    }
  } catch (e) {
    // 讀不到就用預設標題，不要讓整頁掛掉
  }
  return { title: "揪呷團" };
}

export default async function GroupPage({ params }) {
  const { id } = await params;
  return <GroupOrderApp initialNav={{ screen: "group", groupId: id, tab: "groups" }} />;
}
