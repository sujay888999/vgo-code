import paramiko
host='38.181.42.161'; user='root'; password='Tr8%Aq7-Ue9?'
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, 22, user, password, timeout=10)

# Check developers page locally
print('=== Local Next.js developers page ===')
stdin, stdout, stderr = client.exec_command("curl -s http://127.0.0.1:7860/developers | grep -o 'VGO CODE v[0-9.]\\+' | head -3")
out = stdout.read().decode().strip()
print(out or 'NO MATCH')

# Check via Cloudflare
print('\n=== Cloudflare developers page headers ===')
stdin, stdout, stderr = client.exec_command("curl -sI https://vgoai.cn/developers | grep -i -E 'cf-cache|server|cache-control'")
print(stdout.read().decode().strip()[:500])

# Check via Cloudflare (HTTP)
print('\n=== Cloudflare dev page content ===')
stdin, stdout, stderr = client.exec_command("curl -s https://vgoai.cn/developers | grep -o 'VGO CODE v[0-9.]\\+' | head -3")
out = stdout.read().decode().strip()
print(out or 'NO MATCH')

# Check Cloudflare API token
print('\n=== Check for Cloudflare API credentials ===')
stdin, stdout, stderr = client.exec_command("find / -maxdepth 4 -name '*cloudflare*' -not -path '*/proc/*' -not -path '*/sys/*' 2>/dev/null | head -5")
print(stdout.read().decode().strip()[:500])

client.close()
