import InstrumentPage from "../[id]/page";

export const metadata = { title: "Nuevo instrumento" };

export default function NewInstrument() {
  return <InstrumentPage params={Promise.resolve({ id: "nuevo" })} />;
}
