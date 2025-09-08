export default function Legend() {
  return (
    <div className="text-[11px] text-slate-400 mb-3">
      <div className="flex gap-4 flex-wrap">
        <span>Green = positive, Red = negative, Yellow ≈ 0</span>
        <span>Purple = frozen (no change vs previous cycle)</span>
        <span>Blue/Orange ring (pct_drv only) = id_pct sign flip (−→+ / +→−)</span>
        <span>pct cells show percentage</span>
      </div>
    </div>
  );
}
