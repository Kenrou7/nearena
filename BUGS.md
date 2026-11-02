# BUGS RESUELTOS

Formato:

- ID:
- Fecha:
- Causa raíz:
- Arreglo aplicado:
- Test que lo cubre:
- Riesgo de regresión:

---

- ID: B-001
- Fecha: 2026-11-02
- Causa raíz: el parser de firmas intentaba base64 antes de base58; algunas firmas base58 válidas quedaban mal decodificadas y resultaban en longitud inválida.
- Arreglo aplicado: ajuste en `decodeSignatureLike` para detectar patrón base58 y priorizar esa decodificación; fallback controlado a base64.
- Test que lo cubre: `parses signature response in base58` en scripts/test/chain-signatures.test.ts
- Riesgo de regresión: bajo, queda cubierto además por casos hex/base64/array/bytes y errores de formato.
