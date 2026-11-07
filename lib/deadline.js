// 每一團都有自己的截止時間（groups.close_at），時間到了就自動結單。
// 開團時預設是「現在起 3 小時」，之後在團的頁面可以改，
// 例如晚上先開明天早餐的團，把截止時間改成隔天 06:30。
export const DEFAULT_CLOSE_HOURS = 3;

// 截止時間最遠能設到幾天後。擋掉手滑選到明年這種情況，
// 也避免一團開著好幾個禮拜都沒人管。
export const MAX_CLOSE_DAYS = 7;
