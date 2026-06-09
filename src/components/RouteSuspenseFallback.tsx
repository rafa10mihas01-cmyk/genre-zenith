// Fallback de Suspense interno — renderizado DENTRO do AppLayout para não
// desmontar sidebar/topbar enquanto o chunk da rota carrega.
// Visualmente neutro: um skeleton sutil que ocupa a área de conteúdo.
export function RouteSuspenseFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh] w-full">
      <div className="flex flex-col items-center gap-3 opacity-60">
        <div className="h-1 w-32 overflow-hidden rounded-full bg-elevated">
          <div className="h-full w-full origin-left rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-nx-indeterminate" />
        </div>
      </div>
    </div>
  );
}
