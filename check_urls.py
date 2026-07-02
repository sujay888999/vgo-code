import paramiko
host='38.181.42.161'; user='root'; password='Tr8%Aq7-Ue9?'
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, 22, user, password, timeout=10)

# Check from the server via localhost
cmds = [
    # Check what serves /downloads/vgo-code/ path via host nginx
    "curl -sI http://127.0.0.1:80/downloads/vgo-code/VGO%20CODE%20Setup%201.3.0.exe 2>/dev/null | head -5",
    # Check via container nginx
    "curl -sI http://127.0.0.1:7860/downloads/vgo-code/VGO%20CODE%20Setup%201.3.0.exe 2>/dev/null | head -5",
    # Check the vgoai.cn domain via localhost
    "curl -sI http://vgoai.cn/downloads/vgo-code/VGO%20CODE%20Setup%201.3.0.exe 2>/dev/null | head -5",
    # List all files in nginx download dir
    "ls -lah /var/www/html/downloads/vgo-code/",
    # List root nginx files
    "ls -lah /var/www/html/*.exe 2>/dev/null",
]

for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print('=== ' + cmd[:60] + ' ===')
    if out: print(out[:500])
    if err: print('ERR: ' + err[:200])
    print()

client.close()
