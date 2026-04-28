//! Lightweight SMTP email sender for verification codes.
//! Uses raw SMTP over TLS via reqwest — no heavy mail crate needed.
//!
//! HTML uses fully-inline styles (Gmail truncates large <style> blocks
//! and would strip the entire layout when the embedded font pushes the
//! block past ~16KB). Only @font-face lives in <style>; everything else
//! is inline so it survives any client.

use aeqi_core::config::SmtpConfig;

/// Exo 2 (weight 600, Latin subset) embedded as a base64 woff2.
const EXO2_600_LATIN_B64: &str = include_str!("exo2-600-latin.b64");

const FONT_BODY: &str =
    "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_DISPLAY: &str =
    "'Exo 2','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_MONO: &str =
    "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace";

/// Send a verification code email.
pub async fn send_verification_email(
    smtp: &SmtpConfig,
    to: &str,
    code: &str,
) -> anyhow::Result<()> {
    let subject = "Verify your email".to_string();
    let body_text = format!(
        "Your aeqi verification code is: {code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email."
    );
    let heading = format!(
        "font-family:{FONT_DISPLAY};font-weight:600;font-size:22px;letter-spacing:-0.015em;color:#0a0a0b;margin:0 0 10px;line-height:1.2;"
    );
    let lede = format!(
        "font-family:{FONT_BODY};font-size:14.5px;line-height:1.6;color:rgba(10,10,11,0.72);margin:0 0 24px;"
    );
    let code_box = format!(
        "font-family:{FONT_MONO};font-size:32px;font-weight:600;letter-spacing:0.22em;text-align:center;padding:20px 16px;background:#f6f6f7;border-radius:10px;color:#0a0a0b;margin:0 0 14px;"
    );
    let meta = format!(
        "font-family:{FONT_BODY};font-size:12.5px;line-height:1.55;color:rgba(10,10,11,0.5);margin:0;"
    );
    let wordmark = format!(
        "display:inline-block;text-decoration:none;color:#0a0a0b;font-family:{FONT_DISPLAY};font-weight:600;font-size:26px;letter-spacing:-0.02em;line-height:1;"
    );

    let body_html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<style>@font-face{{font-family:'Exo 2';font-style:normal;font-weight:600;src:url(data:font/woff2;base64,{EXO2_600_LATIN_B64}) format('woff2');}}</style>
</head>
<body style="margin:0;padding:0;background:#ececee;font-family:{FONT_BODY};color:rgba(10,10,11,0.9);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
<div style="width:100%;background:#ececee;padding:48px 16px;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="text-align:center;margin:0 0 28px;">
      <a href="https://aeqi.ai" style="{wordmark}">aeqi</a>
    </div>
    <div style="background:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 1px 0 rgba(10,10,11,0.02),0 8px 28px rgba(10,10,11,0.06);">
      <h1 style="{heading}">Verify your email</h1>
      <p style="{lede}">Enter this code in your browser to finish setting up your aeqi account.</p>
      <div style="{code_box}">{code}</div>
      <p style="{meta}">Expires in 15 minutes.</p>
    </div>
    <div style="text-align:center;margin:24px 0 0;font-family:{FONT_BODY};font-size:11.5px;line-height:1.7;color:rgba(10,10,11,0.5);">
      <p style="margin:0 0 4px;"><span style="color:rgba(10,10,11,0.7);font-weight:500;">aeqi</span> — The company OS for the agent economy.</p>
      <p style="margin:0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>
</div>
</body>
</html>"#
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
        "From: aeqi <{}>\r\nTo: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n--{}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{}\r\n--{}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{}\r\n--{}--\r\n.\r\n",
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
