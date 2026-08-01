import GroupOrderApp from "../../components/GroupOrderApp";
import { sql } from "@/lib/db";

// 讓分享菜單網址時，預覽卡片能顯示店名
export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const rows = await sql`select store_name from menus where id = ${id}`;
    if (rows.length > 0) {
      const storeName = rows[0].store_name;
      return {
        title: `${storeName} 菜單｜揪呷團`,
        description: `看看 ${storeName} 有什麼可以點`,
        openGraph: {
          title: `${storeName} 菜單`,
          description: `看看 ${storeName} 有什麼可以點`,
        },
      };
    }
  } catch (e) {
    // 讀不到就用預設標題，不要讓整頁掛掉
  }
  return { title: "菜單｜揪呷團" };
}

export default async function MenuPage({ params }) {
  const { id } = await params;
  return <GroupOrderApp initialNav={{ screen: "menuDetail", menuId: id, tab: "menus" }} />;
}
