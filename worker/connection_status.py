"""Check a fresh acknowledgement written only after a successful service heartbeat."""
import json
import os
import sys
import time
from ticket_executor import STATE, private_json

PATH=STATE/'connection-status.json'

def mark_connected():
    private_json(PATH,{'pid':os.getpid(),'connected_at':time.time()})

def fresh(status,pid,now):
    return isinstance(status,dict) and status.get('pid')==pid and isinstance(status.get('connected_at'),(int,float)) and 0<=now-status['connected_at']<30

def main():
    pid=int(sys.argv[1]);deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        try:
            if fresh(json.loads(PATH.read_text()),pid,time.time()):
                print('PC connecté à Supabase : authentification, événements et présence confirmés.')
                return
        except (OSError,ValueError,TypeError):pass
        time.sleep(1)
    print('Le service tourne, mais la connexion Supabase n’est pas confirmée. Copie ce message ; ne recrée pas ta demande.')
    raise SystemExit(1)

if __name__=='__main__':main()
