#!/usr/bin/env python3
"""Trusted offline acceptance transport; never import engine.js into Python."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
NODE = Path('/usr/bin/node')
MAX_PACKET = 1048576
MAX_SOURCE = 131072
MAX_OUTPUT = 16777216
ACORN_SHA256 = '24974706ffc00984a334f9ee085cc3cb2bf0a0ec80787ea9374ab5b5b6535681'
GUARD_SHA256 = 'd6c3f2433d74a98531cf8bd8882db4d72abcf54ab2872c38c05a55c2ea79d1cb'
DRIVER_SHA256 = 'd9cbc7b4fa6ede3721462a34ca04fdec3376ab3b76fcf30981be06ac11a779be'
NODE_FLAGS = ['--disallow-code-generation-from-strings', '--no-addons',
              '--disable-proto=throw', '--max-old-space-size=128']

def _fail():
    raise ValueError('OFFLINE_CHECK_FAILED')

def _strict(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                _fail()
            result[key] = value
        return result
    def constant(_):
        _fail()
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, TypeError, RecursionError):
        _fail()

def _read(path, limit):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        _fail()
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                    or before.st_nlink != 1 or before.st_size > limit):
                _fail()
            raw = os.read(fd, limit + 1)
            after = os.fstat(fd)
            if len(raw) > limit or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                _fail()
            return raw
        finally:
            os.close(fd)
    except (OSError, ValueError):
        _fail()

def _assets():
    result = {}
    for name, expected in (('engine_guard.cjs', GUARD_SHA256),
                           ('batch_driver.mjs', DRIVER_SHA256),
                           ('vendor/acorn.cjs', ACORN_SHA256)):
        raw = _read(HERE / name, 400000)
        if hashlib.sha256(raw).hexdigest() != expected:
            _fail()
        result[name] = raw
    return result

@contextmanager
def _runtime():
    assets = _assets()
    with tempfile.TemporaryDirectory(prefix='atendimento-runtime-') as temp:
        root=Path(temp);root.chmod(0o755)
        for name,raw in assets.items():
            path=root/name;path.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
            path.write_bytes(raw);path.chmod(0o444)
        yield root

def _hosted_ci():
    return all(os.environ.get(k)==v for k,v in {'GITHUB_ACTIONS':'true','CI':'true',
        'RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'Linux'}.items())

def _base(*, outer=False):
    # Oracle Python and generated Node are isolated siblings, never nested.
    command = (['/usr/bin/sudo','-n','--'] if _hosted_ci() else []) + ['/usr/bin/setpriv', '--no-new-privs', '/usr/bin/bwrap',
        '--unshare-all', '--unshare-user', '--cap-drop', 'ALL', '--die-with-parent',
        '--new-session', '--clearenv']
    command += ['--disable-userns']
    if outer:
        command += ['--ro-bind', '/usr', '/usr']
    else:
        command += ['--ro-bind', str(NODE), '/usr/bin/node',
                    '--ro-bind', '/usr/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu']
        # Debian Node externalizes these otherwise embedded standard runtimes.
        for name in ('cjs-module-lexer/lexer.js','cjs-module-lexer/dist/lexer.js',
                     'undici/undici-fetch.js','acorn/dist/acorn.js',
                     'acorn-walk/dist/walk.js','minimatch/dist/cjs/index.bundle.js'):
            path=Path('/usr/share/nodejs')/name
            if path.is_file():command += ['--ro-bind',str(path),str(path)]
    command += ['--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64']
    if not outer:
        command += ['--dir', '/usr/lib64', '--ro-bind', '/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2', '/usr/lib64/ld-linux-x86-64.so.2']
    command += ['--proc', '/proc', '--dev', '/dev', '--perms', '0700', '--tmpfs', '/tmp',
        '--perms', '0700', '--dir', '/tmp/empty-home', '--setenv', 'HOME', '/tmp/empty-home',
        '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8']
    return command

def _limits(timeout):
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT))
    seconds = max(1, math.ceil(timeout) + 2)
    resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds))

def _capture(command, raw=b'', timeout=25, public_failure_log=False):
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 180:
        _fail()
    try:
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            result = subprocess.run(command, input=raw, stdout=output, stderr=errors,
                timeout=timeout, check=False, env={'PATH': '/usr/bin:/bin'},
                preexec_fn=lambda: _limits(timeout), close_fds=True)
            if output.tell() > MAX_OUTPUT or errors.tell() > MAX_OUTPUT:
                _fail()
            output.seek(0)
            errors.seek(0)
            stdout, stderr = output.read(MAX_OUTPUT + 1), errors.read(MAX_OUTPUT + 1)
            if result.returncode != 0 or stderr:
                if public_failure_log and stdout.startswith(b'PUBLIC_TEST_LOG_BEGIN\n') and stdout.endswith(b'PUBLIC_TEST_LOG_END\n'):
                    sys.stdout.write(stdout[:1048576].decode('utf-8',errors='replace'))
                _fail()
            return stdout
    except (OSError, subprocess.SubprocessError, ValueError):
        _fail()

def guard_source(source: str):
    """Parse only in its own no-home/no-network user namespace."""
    if type(source) is not str:
        _fail()
    try:
        raw = source.encode('utf-8')
    except UnicodeError:
        _fail()
    if len(raw) > MAX_SOURCE:
        _fail()
    with _runtime() as runtime:
        command = _base() + ['--ro-bind', str(runtime), '/driver', '--chdir', '/tmp',
            '/usr/bin/node', *NODE_FLAGS, '/driver/engine_guard.cjs']
        if _capture(command, raw, 10) != b'ENGINE_OK\n':
            _fail()

def _project(path):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_dir():
        _fail()
    return path

def _packet(cases):
    if type(cases) is not list or len(cases) > 256:
        _fail()
    try:
        raw = json.dumps({'cases': cases}, ensure_ascii=False, allow_nan=False,
                         separators=(',', ':')).encode('utf-8')
    except (TypeError, ValueError, UnicodeError, RecursionError):
        _fail()
    if len(raw) > MAX_PACKET:
        _fail()
    return raw

def execute_cases(project, cases, timeout=25):
    """Return closed batch protocol. No oracle/test files enter the Node namespace."""
    project = _project(project)
    raw = _packet(cases)
    if os.environ.get('ORACLE_BROKER')=='1':
        return _oracle_exchange(project,cases,timeout)
    source = _read(project / 'src/engine.js', MAX_SOURCE)
    try:
        guard_source(source.decode('utf-8'))
    except UnicodeError:
        _fail()
    with tempfile.TemporaryDirectory(prefix='atendimento-engine-') as temp, _runtime() as runtime:
        Path(temp).chmod(0o755)
        app = Path(temp) / 'app'
        app.mkdir(mode=0o755)
        (app / 'src').mkdir(mode=0o755)
        (app / 'src/engine.js').write_bytes(source)
        (app / 'package.json').write_text('{"type":"module"}\n')
        for path in (app/'src/engine.js',app/'package.json'):path.chmod(0o444)
        command = _base() + ['--ro-bind', str(app), '/app', '--ro-bind', str(runtime), '/driver',
            '--chdir', '/app', '/usr/bin/node', *NODE_FLAGS, '/driver/batch_driver.mjs']
        result = _strict(_capture(command, raw, timeout))
    return _result(result,len(cases))

def _result(result,count):
    if type(result) is not dict or set(result) != {'results'} or type(result['results']) is not list or len(result['results']) != count:
        _fail()
    for row in result['results']:
        if type(row) is not dict or type(row.get('ok')) is not bool:
            _fail()
        if row['ok']:
            if set(row) != {'ok', 'value'}:
                _fail()
        elif set(row) != {'ok', 'error'} or row['error'] not in ('TypeError', 'RangeError'):
            _fail()
    return result

def _oracle_context(project):
    if HERE!=Path('/app/scripts') or project!=Path('/app') or not Path('/oracle').is_dir():_fail()
    status=Path('/proc/self/status').read_text()
    if not re.search(r'^CapEff:\s*0+$',status,re.M) or not re.search(r'^NoNewPrivs:\s*1$',status,re.M):_fail()
    if Path('/home').exists() or Path('/root').exists():_fail()
    for path in ('/app','/oracle'):
        if not any(row.split()[4]==path and 'ro' in row.split()[5].split(',') for row in Path('/proc/self/mountinfo').read_text().splitlines()):_fail()
    if len(Path('/proc/net/route').read_text().strip().splitlines())!=1:_fail()

def _oracle_exchange(project,cases,timeout):
    _oracle_context(project)
    if type(timeout) not in (int,float) or not math.isfinite(timeout) or not 0<timeout<=180:_fail()
    state=sys.modules.setdefault('_atendimento_broker_state',SimpleNamespace(seq=0))
    state.seq+=1
    raw=json.dumps({'v':1,'seq':state.seq,'cases':cases},ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()+b'\n'
    if len(raw)>MAX_PACKET+128:_fail()
    sys.__stdout__.buffer.write(raw);sys.__stdout__.buffer.flush()
    deadline=time.monotonic()+timeout+2;received=bytearray();fd=sys.__stdin__.fileno()
    while b'\n' not in received:
        left=deadline-time.monotonic()
        if left<=0 or not select.select([fd],[],[],left)[0]:_fail()
        chunk=os.read(fd,65536)
        if not chunk:_fail()
        received.extend(chunk)
        if len(received)>MAX_OUTPUT+128:_fail()
    line,tail=bytes(received).split(b'\n',1)
    if tail:_fail()
    result=_strict(line)
    if (type(result)is not dict or set(result)!={'v','seq','result'} or type(result['v'])is not int
        or result['v']!=1 or type(result['seq'])is not int or result['seq']!=state.seq):_fail()
    return _result(result['result'],len(cases))

def _public(project):
    guard_source(_read(project / 'src/engine.js', MAX_SOURCE).decode('utf-8'))
    # Public checkout only: never carry Git credentials/history or private oracle.
    with tempfile.TemporaryDirectory(prefix='atendimento-public-') as temp, _runtime() as runtime:
        Path(temp).chmod(0o755);app=Path(temp)/'app';app.mkdir(mode=0o755)
        for directory,names,files in os.walk(project,followlinks=False):
            names[:]=[n for n in names if n not in ('.git','node_modules','.venv','__pycache__','dist','oracle','independent') and (not n.startswith('.') or n=='.github')]
            for name in names:
                if (Path(directory)/name).is_symlink():_fail()
            for name in files:
                if name.startswith('.') and name!='.gitignore':continue
                source=Path(directory)/name;relative=source.relative_to(project)
                target=app/relative;target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
                target.write_bytes(_read(source,2000000));target.chmod(0o444)
        command = _base() + ['--ro-bind', str(app), '/app', '--ro-bind', str(runtime), '/driver',
            '--chdir', '/app', '/usr/bin/node', *NODE_FLAGS, '/driver/batch_driver.mjs', '--public']
        text = _capture(command, timeout=100,public_failure_log=True).decode('utf-8')
    if not re.fullmatch(r'PUBLIC_TESTS [1-9][0-9]*\nPROOF [^\n]+\n', text):
        _fail()
    print(text, end='')

def _oracle(project, oracle):
    oracle = _project(oracle)
    _read(oracle / 'run_independent.py', 1000000)
    # Oracle sees source RO; only cases cross a strict JSON protocol. The host
    # launches fresh sibling Node namespaces without oracle mounts or FDs.
    program = """import json,re,runpy,socket,sys;from pathlib import Path
s=Path('/proc/self/status').read_text();assert re.search(r'^CapEff:\\s*0+$',s,re.M)and re.search(r'^NoNewPrivs:\\s*1$',s,re.M)
assert not Path('/home').exists()and not Path('/root').exists()
for p in ('/app','/oracle'):assert any(r.split()[4]==p and 'ro'in r.split()[5].split(',')for r in Path('/proc/self/mountinfo').read_text().splitlines())
probe=runpy.run_path('/app/scripts/checks-offline.py',run_name='trusted_probe')
assert probe['execute_cases']('/app',[],timeout=10)=={'results':[]}
sys.argv=['/oracle/run_independent.py','/app','/app/scripts/checks-offline.py']
runpy.run_path(sys.argv[0],run_name='__main__')
"""
    command = _base(outer=True) + ['--ro-bind', str(project), '/app', '--ro-bind', str(oracle), '/oracle',
        '--setenv','ORACLE_BROKER','1',
        '--chdir', '/app', '/usr/bin/python3', '-I', '-B', '-c', program]
    text=_oracle_broker(command,project)
    found=re.findall(r'^(Ran [1-9][0-9]* tests? in [0-9.]+s)$',text,re.M)
    if len(found)!=1 or not re.search(r'^OK$',text,re.M):
        _fail()
    print(found[0]+'\n\nOK')
    print('PROOF '+json.dumps({'sourceReadOnly':True,'oracleReadOnly':True,'innerOracleAbsent':True,
        'homeEmpty':True,'credentialsAbsent':True,'environmentClean':True,'CapEff':0,'NoNewPrivs':1,'networkError':'ENETUNREACH',
        'oracleTransport':'sibling_broker_v1'}))

def _oracle_broker(command,project):
    deadline=time.monotonic()+180
    with tempfile.TemporaryFile() as errors:
        process=None
        try:
            process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,
                env={'PATH':'/usr/bin:/bin'},preexec_fn=lambda:_limits(180),close_fds=True)
            reader=process.stdout.fileno();writer=process.stdin.fileno()
            os.set_blocking(reader,False);os.set_blocking(writer,False)
            incoming=bytearray();pending=b'';seq=0;total_in=0;total_out=0;eof=False
            while not eof:
                remaining=deadline-time.monotonic()
                if remaining<=0 or errors.tell()>MAX_OUTPUT:_fail()
                readable,writable,_=select.select([reader] if not pending else [],[writer] if pending else [],[],min(remaining,.2))
                if writable:
                    try:pending=pending[os.write(writer,pending[:65536]):]
                    except BlockingIOError:pass
                if readable:
                    try:chunk=os.read(reader,65536)
                    except BlockingIOError:continue
                    if not chunk:eof=True;continue
                    incoming.extend(chunk);total_in+=len(chunk)
                    if len(incoming)>MAX_PACKET+128 or total_in>64*1024*1024:_fail()
                    if b'\n' not in incoming:continue
                    line,tail=bytes(incoming).split(b'\n',1)
                    if tail or seq>=512:_fail()
                    incoming.clear();request=_strict(line)
                    if (type(request)is not dict or set(request)!={'v','seq','cases'}
                        or type(request['v'])is not int or request['v']!=1 or type(request['seq'])is not int
                        or request['seq']!=seq+1):_fail()
                    _packet(request['cases']);seq+=1
                    value=execute_cases(project,request['cases'],timeout=min(25,max(.01,deadline-time.monotonic())))
                    pending=json.dumps({'v':1,'seq':seq,'result':value},ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()+b'\n'
                    total_out+=len(pending)
                    if len(pending)>MAX_OUTPUT+128 or total_out>128*1024*1024:_fail()
            if incoming or pending or seq<1:_fail()
            process.stdin.close()
            code=process.wait(timeout=max(.01,deadline-time.monotonic()))
            if code or errors.tell()>MAX_OUTPUT:_fail()
            errors.seek(0)
            return errors.read(MAX_OUTPUT).decode('utf-8',errors='strict')
        except (OSError,ValueError,UnicodeError,subprocess.SubprocessError):
            _fail()
        finally:
            if process is not None:
                if process.poll() is None:process.kill();process.wait()
                if process.stdin and not process.stdin.closed:process.stdin.close()
                if process.stdout:process.stdout.close()

def main(argv=None):
    parser=argparse.ArgumentParser(add_help=False)
    parser.add_argument('--oracle-dir', type=Path)
    parser.add_argument('--run-cases', action='store_true')
    try:
        args=parser.parse_args(argv)
        if os.environ.get('ORACLE_BROKER')=='1':_fail()
        if args.oracle_dir is not None and args.run_cases:
            _fail()
        project=_project(HERE.parent)
        if args.run_cases:
            raw=sys.stdin.buffer.read(MAX_PACKET+1)
            if len(raw)>MAX_PACKET:
                _fail()
            packet=_strict(raw)
            if type(packet)is not dict or set(packet)!={'cases'}:
                _fail()
            print(json.dumps(execute_cases(project,packet['cases']),ensure_ascii=False,allow_nan=False,separators=(',',':')))
        elif args.oracle_dir is not None:
            _oracle(project,args.oracle_dir)
        else:
            _public(project)
        return 0
    except (Exception,SystemExit):
        print('OFFLINE_CHECK_FAILED',file=sys.stderr)
        return 2

if __name__=='__main__':
    raise SystemExit(main())
