// No global CSS import here!
import styles from "./layout.module.css"; // optional; remove if you don't want styles

export const metadata = { title: "CryptoPi · Strategy AUX" };

export default function StrAuxLayout({ children }: { children: React.ReactNode }) {
  return <section className={styles.wrapper}>{children}</section>;
}
