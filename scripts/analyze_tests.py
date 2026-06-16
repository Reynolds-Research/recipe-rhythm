import os
import sys
import json
import smtplib
from email.message import EmailMessage
from google import genai

def send_email(subject, html_content, sender, receiver, password):
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = receiver
    
    full_html = f"""
    <html>
      <head>
        <style>
          body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }}
          h1 {{ color: #2c3e50; }}
          h2 {{ color: #34495e; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 30px; }}
          .pass {{ color: #27ae60; font-weight: bold; }}
          .fail {{ color: #c0392b; font-weight: bold; }}
          .container {{ max-width: 800px; margin: 0 auto; padding: 20px; }}
        </style>
      </head>
      <body>
        <div class="container">
          {html_content}
        </div>
      </body>
    </html>
    """
    
    msg.add_alternative(full_html, subtype='html')
    
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(sender, password)
            smtp.send_message(msg)
            print("Email sent successfully!")
    except Exception as e:
        print(f"Failed to send email: {e}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_tests.py <path_to_test_results.json>")
        sys.exit(1)

    results_file = sys.argv[1]
    
    if not os.path.exists(results_file):
        print(f"File not found: {results_file}")
        sys.exit(1)
        
    with open(results_file, 'r') as f:
        try:
            results_data = json.load(f)
        except json.JSONDecodeError:
            print("Invalid JSON file")
            sys.exit(1)

    # Extract relevant data from Playwright JSON output
    # Playwright JSON reporter structure: { errors: [], suites: [...], stats: { expected: N, unexpected: N, duration: N ... } }
    
    stats = results_data.get('stats', {})
    duration_s = stats.get('duration', 0) / 1000
    expected = stats.get('expected', 0) # Passed
    unexpected = stats.get('unexpected', 0) # Failed
    flaky = stats.get('flaky', 0)
    
    # We will just pass the raw stats and errors to the AI
    errors = results_data.get('errors', [])
    error_summary = []
    
    # Limit errors to avoid huge payloads
    for err in errors[:5]:
        error_summary.append({
            "message": err.get("message", "Unknown error"),
            "location": err.get("location", "Unknown location")
        })

    summary_data = {
        "duration_seconds": duration_s,
        "passed": expected,
        "failed": unexpected,
        "flaky": flaky,
        "errors": error_summary
    }

    print(f"Test Summary: {summary_data}")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY environment variable not set.")
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    prompt = (
        "You are a QA automation expert. I am providing you with the summary of a Playwright E2E test run for my application (Recipe Rhythm).\n"
        f"Test Data: {json.dumps(summary_data, indent=2)}\n\n"
        "Please analyze these results and provide a concise, high-level summary of the application's health. "
        "If there are failed tests, review the error messages, identify the likely root cause (e.g., selector mismatch, timeout, network error), "
        "and suggest a potential fix or next steps.\n"
        "Format your output as a clean, highly readable HTML snippet (do NOT include ```html, just the raw HTML). "
        "Use appropriate headings, and use colors for Pass/Fail status (e.g. using CSS classes .pass and .fail if needed). "
    )

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        html_content = response.text.strip()
        if html_content.startswith('```html'): html_content = html_content[7:]
        if html_content.startswith('```'): html_content = html_content[3:]
        if html_content.endswith('```'): html_content = html_content[:-3]
        html_content = html_content.strip()
    except Exception as e:
        print(f"Error generating AI response: {e}")
        html_content = f"<h2>Error analyzing test results</h2><p>{str(e)}</p>"

    # Send Email
    sender = os.environ.get("EMAIL_SENDER")
    receiver = os.environ.get("EMAIL_RECEIVER")
    password = os.environ.get("EMAIL_PASSWORD")

    if not sender or not receiver or not password:
        print("Email environment variables not set. Cannot send email.")
        # But we still print the AI output for debugging
        print("\n--- AI HTML Output ---")
        print(html_content)
        sys.exit(1)

    send_email("Weekly E2E Test Report - Recipe Rhythm", html_content, sender, receiver, password)

if __name__ == "__main__":
    main()
