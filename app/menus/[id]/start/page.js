import StartGroupFlow from "../../../components/StartGroupFlow";
import { sql } from "@/lib/db";

async function getStoreName(id) {
  try {
    const rows = await sql`select store_name from menus where id = ${id}`;
    return rows.length > 0 ? rows[0].store_name : null;
  } catch (e) {
    return null;
  }
}

// 讓這條「一鍵開團」網址貼到 LINE 時，預覽卡片直接顯示店名
export async function generateMetadata({ params }) {
  const { id } = await params;
  const storeName = await getStoreName(id);
  if (!storeName) return { title: "揪呷團" };
  return {
    title: `${storeName}｜點我一起點餐`,
    description: `點進來加入 ${storeName} 的揪團`,
    openGraph: {
      title: `${storeName}｜點我一起點餐`,
      description: `點進來加入 ${storeName} 的揪團`,
    },
  };
}

export default async function StartGroupPage({ params }) {
  const { id } = await params;
  const storeName = await getStoreName(id);
  return <StartGroupFlow menuId={id} storeName={storeName} />;
}
