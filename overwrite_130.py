import paramiko
host='38.181.42.161'; user='root'; password='Tr8%Aq7-Ue9?'
container = 'api-platform'
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, 22, user, password, timeout=10)

# Copy 1.3.1 installer to also serve as 1.3.0 filename in all locations
actions = [

    # Host nginx dir (/var/www/html) - the 1.3.0.exe is directly in /var/www/html/
    ("cp /var/www/html/downloads/vgo-code/VGO\\ CODE\\ Setup\\ 1.3.1.exe /var/www/html/VGO\\ CODE\\ Setup\\ 1.3.0.exe", "Nginx root"),

    # Host nginx downloads subdir
    ("cp /var/www/html/downloads/vgo-code/VGO\\ CODE\\ Setup\\ 1.3.1.exe /var/www/html/downloads/vgo-code/VGO\\ CODE\\ Setup\\ 1.3.0.exe", "Nginx download"),

    # Host app frontend public dir
    ("cp '/app/frontend/public/downloads/vgo-code/VGO CODE Setup 1.3.1.exe' '/app/frontend/public/downloads/vgo-code/VGO CODE Setup 1.3.0.exe'", "Host frontend"),

    # Container public dir
    ("docker exec " + container + " cp '/app/frontend/public/downloads/vgo-code/VGO CODE Setup 1.3.1.exe' '/app/frontend/public/downloads/vgo-code/VGO CODE Setup 1.3.0.exe'", "Container frontend"),
]

for cmd, label in actions:
    print('  ' + label + '...', flush=True)
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print('    ' + out[:200])
    if err: print('    ERR: ' + err[:200])
    else: print('    OK', flush=True)

# Verify
print('\nVerification:', flush=True)
stdin, stdout, stderr = client.exec_command('find /var/www/html /app/frontend/public -name "*1.3.0*" 2>/dev/null | sort')
out = stdout.read().decode().strip()
for line in out.split('\n'):
    print('  ' + line)

# Check HTTP access
print('\nHTTP check:', flush=True)
stdin, stdout, stderr = client.exec_command('curl -sI http://127.0.0.1:80/VGO%20CODE%20Setup%201.3.0.exe 2>/dev/null | head -3')
print(stdout.read().decode().strip())

client.close()
print('\nDone!')
