const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '../../..');
function dockerCommand(tail, options = {}) {
    const bundled = 'C:/Users/latop/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
    const executable = process.env.DOCKER_BIN || (fs.existsSync(bundled) ? bundled : 'docker');
    const args = ['compose','--env-file',path.join(root,'keycloak/.env'),'-f',path.join(root,'keycloak/compose.yaml'), ...tail];
    const result = spawnSync(executable, args, { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...options });
    if (result.error || result.status !== 0) {
        const error = new Error('Không thao tác được PostgreSQL Docker. Kiểm tra Docker Desktop và stack Keycloak.');
        error.code = result.error?.code || 'DOCKER_COMMAND_FAILED';
        throw error;
    }
    return result;
}
module.exports = { root, dockerCommand };
