-- Aplicado em produção em 2026-11-18.
-- Valor recebido fora do banco (dinheiro / Pix anotado à mão) de uma entrega.
-- Nulo = o que falta depois dos Pix ligados à entrega (assim o mesmo pagamento não conta duas vezes).
alter table public.fin_entregas add column if not exists valor numeric;
