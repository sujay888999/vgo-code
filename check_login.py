import paramiko
host='38.181.42.161'; user='root'; password='Tr8%Aq7-Ue9?'
container = 'api-platform'
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, 22, user, password, timeout=10)

# Check login.html for 1.3.0
stdin, stdout, stderr = client.exec_command("docker exec " + container + " grep -n '1.3.0\\|1.3.1' /app/frontend/.next/server/app/login.html | head -20")
out = stdout.read().decode().strip()
print('Login page version refs:')
print(out or 'NONE')

# Check teams page HTML
stdin, stdout, stderr = client.exec_command("docker exec " + container + " grep -n '1.3.0\\|1.3.1' /app/frontend/.next/server/app/teams.html | head -20")
out = stdout.read().decode().strip()
print('\nTeams page version refs:')
print(out or 'NONE')

# Check workspace page HTML  
stdin, stdout, stderr = client.exec_command("docker exec " + container + " grep -n '1.3.0\\|1.3.1' /app/frontend/.next/server/app/workspace.html | head -20")
out = stdout.read().decode().strip()
print('\nWorkspace page HTML version refs:')
print(out or 'NONE')

client.close()
