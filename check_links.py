import paramiko
host='38.181.42.161'; user='root'; password='Tr8%Aq7-Ue9?'
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, 22, user, password, timeout=10)

cmd = "curl -s https://vgoai.cn/developers | grep -oE 'VGO CODE Setup [0-9.]+\\.exe' | head -5"
stdin, stdout, stderr = client.exec_command(cmd)
out = stdout.read().decode().strip()
print('Download links on page:')
print(out or 'NONE')

cmd2 = "curl -s https://vgoai.cn/developers | grep -oE 'VGO CODE v[0-9.]+' | head -5"
stdin, stdout, stderr = client.exec_command(cmd2)
out2 = stdout.read().decode().strip()
print('\nVersion text on page:')
print(out2 or 'NONE')

client.close()
