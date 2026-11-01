"""One lightweight event receiver; separate bounded audio/text child and one Codex session."""
import multiprocessing as mp
import signal
import threading
import time
from pathlib import Path
from atelier_worker import Gateway, Runner
from realtime_events import RealtimeEvents
from ticket_executor import TicketExecutor, ProcessLock, ExecutionError, read_registry, preflight, STATE, available_models

def main():
    lock=ProcessLock(STATE/'service.lock')
    wake=threading.Event();stop=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda *_:stop.set())
    gateway=Gateway();ai=Runner(gateway,mp.get_context('spawn'));code=TicketExecutor(gateway)
    events=RealtimeEvents(Gateway,wake)
    ready=False
    try:
        preflight();ready=True
    except Exception:
        print('Codex désactivé : lancez worker/ticket_executor.py doctor. Dictée et notes restent disponibles.',flush=True)
    events.start();last_heartbeat=0;last_registry=0;allowed=[]
    print('Atelier PC : réception événementielle sortante ; une seule session Codex à la fois.',flush=True)
    try:
        while not stop.is_set():
            try:
                # Supervision precedes registry/presence requests. A separate watchdog
                # also enforces the deadline if any RPC blocks this thread.
                if code.process and code.tick():wake.set()
                notified=wake.is_set()
                if notified:wake.clear()
                now=time.monotonic()
                if events.connected.is_set() and now-last_registry>30:
                    rows=read_registry()
                    models=available_models() if ready else []
                    # Only registered paths and a verified sandbox can advertise execution.
                    gateway.rpc('worker_repository_sync',{'p_repositories':[{**r,'enabled':ready and bool(models),'codex_models':models} for r in rows]})
                    allowed=[r['id'] for r in rows] if ready and models else []
                    last_registry=now
                if events.connected.is_set() and now-last_heartbeat>10:
                    gateway.rpc('worker_heartbeat',{'p_capabilities':ai.current_capabilities()})
                    last_heartbeat=now
                previous=ai.child
                if ai.child or (notified and events.connected.is_set()):
                    ai.tick(allow_claim=notified and events.connected.is_set())
                if previous and not ai.child:wake.set()
                if not code.process and notified and events.connected.is_set() and allowed:
                    job=gateway.rpc('worker_development_claim',{'p_repositories':allowed})
                    if job:
                        try:code.start(job)
                        except Exception as error:
                            detail=str(error) if isinstance(error,ExecutionError) else 'La préparation locale a été refusée. Vérifiez le registre, Git et ticket_executor.py doctor.'
                            gateway.rpc('worker_development_finish',{'p_id':job['id'],'p_lease':job['lease'],
                                'p_result':{'summary':detail,'tests':[],'limitations':['Aucun résultat de code validé.']},
                                'p_error':'Préparation locale refusée ; aucune relance automatique.'})
                            wake.set()
                # Notifications can be coalesced; after each completed operation we drain again.
            except Exception:
                print('Communication ou configuration indisponible ; travail conservé, nouvelle tentative automatique.',flush=True)
                wake.set()
                stop.wait(2)
            stop.wait(0.25 if ai.child or code.process else 1)
    finally:
        code.close();ai.cleanup();events.close();lock.close()

if __name__=='__main__':main()
