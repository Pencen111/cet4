// =====================================================
// 云端同步配置（可选）
// 想实现手机/平板/电脑之间的收藏、错题同步，请：
//   1) 到 https://supabase.com 免费注册并新建一个项目
//   2) 在项目 Settings -> API 里找到 Supabase URL 和 anon public key
//   3) 把下面两个值填好，并按 supabase.sql 建表即可
// 不填则页面为“本地模式”，收藏/错题只保存在当前浏览器。
// =====================================================
window.APP_CONFIG = {
  supabaseUrl: "https://xrcdpebabufvxulkrmvh.supabase.co",        // 例如 "https://xxxx.supabase.co"
  supabaseAnonKey: "sb_publishable_tEtCDEP5PBjUygYB05vuoA_iIewRCxP"     // 例如 "eyJhbGciOi...（一长串）"
};
