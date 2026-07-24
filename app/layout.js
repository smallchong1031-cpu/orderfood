import "./globals.css";

export const metadata = {
  title: "揪呷團",
  description: "上傳菜單・揪團點餐・一鍵結帳",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
