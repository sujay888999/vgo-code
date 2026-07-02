import paramiko
host='38.181.42.161'; user='root'; password='Tr8%Aq7-Ue9?'
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, 22, user, password, timeout=10)

cmd = "curl -s https://vgoai.cn/developers | grep -i '1\\.3\\.0\\|1\\.3\\.1' | head -20"
stdin, stdout, stderr = client.exec_command(cmd)
out = stdout.read().decode().strip()
print('Lines with version info:')
print(out or 'NONE')

client.close()
