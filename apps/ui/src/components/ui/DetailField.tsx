interface DetailFieldProps {
  label: string;
  children: React.ReactNode;
}

export default function DetailField({ label, children }: DetailFieldProps) {
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className="detail-field-value">{children}</div>
    </div>
  );
}
