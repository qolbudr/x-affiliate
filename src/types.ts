export interface Product {
  /** Nama produk yang dipakai AI buat nyusun tweet */
  name: string;
  /** Affiliate link Shopee (sudah di-shorten via s.shopee.co.id kalau bisa) */
  affiliateLink: string;
  /** Harga dalam format string, ex: "Rp45rb", "45 ribuan" */
  price: string;
  /**
   * URL gambar produk (publicly accessible, https only).
   * Buffer X mendukung max 4 gambar per tweet.
   * Contoh ambil dari: cf.shopee.co.id/file/...  atau hosting publik lainnya.
   * Kosongin / hilangin kalau gak ada gambar (post tetap jalan tanpa media).
   */
  images?: string[];
}

export type TweetFormat = 'single' | 'best_buy';

export interface PostLogEntry {
  timestamp: string;
  tweetId: string | null;
  productName: string;
  affiliateLink: string;
  format: TweetFormat;
  text: string;
  replyTweetId?: string | null;
  dryRun: boolean;
  error?: string;
}

export interface RotatorState {
  lastPostedNames: string[];
  postsToday: number;
  postsDate: string; // YYYY-MM-DD WIB
}
