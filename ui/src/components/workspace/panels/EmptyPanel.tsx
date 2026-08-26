export function EmptyPanel() {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-bg">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-6xl mb-4">🌳</div>
          <div className="text-[18px] font-semibold text-text mb-1.5">Arbor</div>
          <div className="text-[14px] text-text-faint">从左侧选择或新建一个智能体开始</div>
        </div>
      </div>
    </div>
  );
}
