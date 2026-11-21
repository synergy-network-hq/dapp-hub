export default function Button({
  variant = "default",
  block = false,
  className = "",
  children,
  ...rest
}) {
  const cls = [
    "btn",
    variant !== "default" && `btn--${variant}`,
    block && "btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
