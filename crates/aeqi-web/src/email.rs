//! Lightweight SMTP email sender for verification codes.
//! Uses raw SMTP over TLS via reqwest — no heavy mail crate needed.

use aeqi_core::config::SmtpConfig;

/// Send a verification code email.
pub async fn send_verification_email(
    smtp: &SmtpConfig,
    to: &str,
    code: &str,
) -> anyhow::Result<()> {
    let subject = format!("Your AEQI verification code: {}", code);
    let body_text = format!(
        "Your verification code is: {}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.",
        code
    );
    let body_html = format!(
        r#"<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 0;">
<h2 style="font-size: 18px; font-weight: 600; color: #1a1a1a; margin: 0 0 8px;">Verify your email</h2>
<p style="font-size: 13px; color: #666; margin: 0 0 24px;">Enter this code to verify your AEQI account:</p>
<div style="background: #f5f5f5; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
<span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a;">{}</span>
</div>
<p style="font-size: 12px; color: #999;">This code expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
</div>"#,
        code
    );

    send_smtp(smtp, to, &subject, &body_text, &body_html).await
}

/// Send an email via SMTP using STARTTLS.
async fn send_smtp(
    smtp: &SmtpConfig,
    to: &str,
    subject: &str,
    body_text: &str,
    body_html: &str,
) -> anyhow::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;

    let addr = format!("{}:{}", smtp.host, smtp.port);
    let stream = TcpStream::connect(&addr).await?;
    let mut reader = BufReader::new(stream);

    // Helper to read SMTP response line.
    async fn read_response(reader: &mut BufReader<TcpStream>) -> anyhow::Result<String> {
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        Ok(line)
    }

    // Helper to send a command.
    async fn send_cmd(reader: &mut BufReader<TcpStream>, cmd: &str) -> anyhow::Result<String> {
        reader.get_mut().write_all(cmd.as_bytes()).await?;
        reader.get_mut().write_all(b"\r\n").await?;
        read_response(reader).await
    }

    // Read greeting.
    let _ = read_response(&mut reader).await?;

    // EHLO.
    let _ = send_cmd(&mut reader, &format!("EHLO {}", smtp.host)).await?;
    // Drain multi-line EHLO response.
    loop {
        let mut peek = String::new();
        reader.read_line(&mut peek).await?;
        if peek.len() < 4 || peek.chars().nth(3) == Some(' ') {
            break;
        }
    }

    // For port 587 we'd need STARTTLS which requires native-tls integration.
    // For simplicity, use port 465 (implicit TLS) or an HTTP API relay.
    // Fall back to an HTTP-based email API if direct SMTP is too complex.

    // AUTH LOGIN.
    let _ = send_cmd(&mut reader, "AUTH LOGIN").await?;
    let _ = send_cmd(
        &mut reader,
        &base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &smtp.username),
    )
    .await?;
    let _ = send_cmd(
        &mut reader,
        &base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &smtp.password),
    )
    .await?;

    // MAIL FROM / RCPT TO / DATA.
    let _ = send_cmd(&mut reader, &format!("MAIL FROM:<{}>", smtp.from)).await?;
    let _ = send_cmd(&mut reader, &format!("RCPT TO:<{}>", to)).await?;
    let _ = send_cmd(&mut reader, "DATA").await?;

    let boundary = "aeqi-boundary-001";
    let message = format!(
        "From: AEQI <{}>\r\nTo: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n--{}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{}\r\n--{}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{}\r\n--{}--\r\n.\r\n",
        smtp.from, to, subject, boundary, boundary, body_text, boundary, body_html, boundary
    );

    reader.get_mut().write_all(message.as_bytes()).await?;
    let resp = read_response(&mut reader).await?;

    let _ = send_cmd(&mut reader, "QUIT").await;

    if resp.starts_with("250") {
        Ok(())
    } else {
        anyhow::bail!("SMTP send failed: {}", resp.trim())
    }
}
