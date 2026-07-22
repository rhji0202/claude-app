export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
      {children && (
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {children}
        </p>
      )}
    </div>
  );
}
