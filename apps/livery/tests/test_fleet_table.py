"""The template table's refresh: what is read from the index, and what the table keeps.

Nothing here goes to the network: the page is made here, in the two ways the index writes a card.
"""

import io
import ssl
import urllib.request

import pytest

from livery.errors import LiveryError
from livery.fleet import cars, net, table, template

HOST = f"https://{template.TEMPLATE_HOST}/members/member_images/cars/car_templates"


def card(name, folder, link, wrapped=True):
    where = (f"<span>Documents</span>/<span>iRacing</span><span>/</span>paint/<span>{folder}</span>" if wrapped
             else f"Documents/<span>iRacing/paint</span>/<span>{folder}</span>")
    return (f'<div id="car" class="grow">\n <a class="link" href="{link}">\n'
            f'  <h3 class="b"><span>{name}</span></h3>\n'
            f'  <div class="o-50"> <img src="https://{table.INDEX_HOST}/folder.svg">\n'
            f'   <span class="akkurat-mono">{where}</span>\n  </div>\n </a>\n</div>\n')


def page(*cards):
    return "<html><body>" + "".join(cards) + "</body></html>"


class Opener:
    def __init__(self, payload: bytes):
        self.payload, self.asked = payload, []

    def __call__(self, request, timeout=None):
        self.asked.append(request.full_url)
        return self

    def __enter__(self):
        return io.BytesIO(self.payload)

    def __exit__(self, *exc):
        return False


def many(n=60):
    return [card(f"Car {i}", f"car{i}", f"{HOST}/{i}_template_C{i}.zip", wrapped=i % 2 == 0) for i in range(n)]


def test_a_card_is_read_however_the_folder_is_wrapped():
    rows, left_out = table.read(page(
        card("Acura ARX-06 GTP", "acuraarx06gtp", f"{HOST}/170_template_AGTP.zip"),
        card("ARCA Chevrolet SS", "stockcars2 arcachevy25", f"{HOST}/198_template_ACSS25.zip", wrapped=False),
        card("Toyota GR86 &amp; friends", "toyotagr86", f"{HOST}/160_template_GR86.zip "),
    ))
    assert left_out == []
    assert rows == [
        cars.TemplateRow("Acura ARX-06 GTP", "acuraarx06gtp", "AGTP", "170", f"{HOST}/170_template_AGTP.zip"),
        cars.TemplateRow("ARCA Chevrolet SS", "stockcars2 arcachevy25", "ACSS25", "198", f"{HOST}/198_template_ACSS25.zip"),
        cars.TemplateRow("Toyota GR86 & friends", "toyotagr86", "GR86", "160", f"{HOST}/160_template_GR86.zip"),
    ]


@pytest.mark.parametrize("folder, link", [
    ("car", "https://example.com/1_template_T.zip"),
    ("car", f"http://{template.TEMPLATE_HOST}/1_template_T.zip"),
    ("car", f"https://{template.TEMPLATE_HOST}.example.com/1_template_T.zip"),
    ("car", f"https://{template.TEMPLATE_HOST}@example.com/1_template_T.zip"),
    ("car", f"{HOST}/1_template_T.exe"),
    ("car", f"{HOST}/setup.zip"),
    ("..", f"{HOST}/1_template_T.zip"),
    ("a/b", f"{HOST}/1_template_T.zip"),
    ("a\\..\\b", f"{HOST}/1_template_T.zip"),
    ("C:car", f"{HOST}/1_template_T.zip"),
])
def test_a_row_is_iracings_address_and_a_plain_folder_or_it_is_left_out(folder, link):
    rows, left_out = table.read(page(card("Car", folder, link)))
    assert rows == []
    assert len(left_out) == 1


def test_a_car_listed_twice_is_one_row_and_two_addresses_are_said():
    rows, left_out = table.read(page(
        card("Monte Carlo", "stockcars chevymontecarlo03", f"{HOST}/1_template_A.zip"),
        card("Monte Carlo", "stockcars chevymontecarlo03", f"{HOST}/1_template_A.zip"),
        card("Taurus", "stockcars fordtaurus03", f"{HOST}/2_template_B.zip"),
        card("Taurus", "stockcars-fordtaurus03", f"{HOST}/3_template_C.zip"),
    ))
    assert [r.template_id for r in rows] == ["1", "2"]
    assert len(left_out) == 1 and "fordtaurus03" in left_out[0]


def test_the_table_gains_and_is_corrected_and_loses_nothing():
    old = [
        cars.TemplateRow("Gone From The Index", "oldcar", "O", "1", f"{HOST}/1_template_O.zip"),
        cars.TemplateRow("Mazda", "mx5-mx52016", "M", "2", f"{HOST}/2_template_M.zip"),
        cars.TemplateRow("Same", "same", "S", "3", f"{HOST}/3_template_S.zip"),
    ]
    new = [
        cars.TemplateRow("Same", "same", "S", "3", f"{HOST}/3_template_S.zip"),
        cars.TemplateRow("Mazda MX-5 Cup", "mx5 mx52016", "M2", "20", f"{HOST}/20_template_M2.zip"),
        cars.TemplateRow("New Car", "newcar", "N", "4", f"{HOST}/4_template_N.zip"),
    ]
    out = table.merge(old, new)
    assert [r.paint_folder for r in out.rows] == ["oldcar", "mx5-mx52016", "same", "newcar"]
    assert [r.paint_folder for r in out.kept] == ["oldcar"]
    assert [r.paint_folder for r in out.added] == ["newcar"]
    assert out.changed == [cars.TemplateRow("Mazda MX-5 Cup", "mx5-mx52016", "M2", "20", f"{HOST}/20_template_M2.zip")]


def test_a_refresh_writes_the_table_whole_with_the_endings_it_had(tmp_path):
    path = tmp_path / "paint_templates.tsv"
    path.write_bytes(("\t".join(table.COLUMNS) + f"\r\nOld Car\toldcar\tO\t900\t{HOST}/900_template_O.zip\r\n").encode())
    opener = Opener(page(*many()).encode())
    out = table.refresh(path, opener=opener)
    assert opener.asked == [table.INDEX]
    assert len(out.added) == 60 and len(out.kept) == 1
    raw = path.read_bytes()
    assert raw.count(b"\r\n") == raw.count(b"\n") == 62
    assert [r.paint_folder for r in cars.load(path)] == ["oldcar"] + [f"car{i}" for i in range(60)]
    assert not list(tmp_path.glob("*.part"))

    before = path.stat().st_mtime_ns
    again = table.refresh(path, opener=opener)
    assert again.added == [] and again.changed == []
    assert path.stat().st_mtime_ns == before


def test_a_dry_run_writes_nothing(tmp_path):
    path = tmp_path / "paint_templates.tsv"
    out = table.refresh(path, opener=Opener(page(*many()).encode()), dry=True)
    assert len(out.added) == 60
    assert not path.exists()


@pytest.mark.parametrize("payload", [b"", b"<html>moved</html>", page(*many(10)).encode()])
def test_a_page_that_is_not_the_index_leaves_the_table_as_it_was(tmp_path, payload):
    path = tmp_path / "paint_templates.tsv"
    table.write([cars.TemplateRow("Old Car", "oldcar", "O", "900", f"{HOST}/900_template_O.zip")], path)
    before = path.read_bytes()
    with pytest.raises(LiveryError):
        table.refresh(path, opener=Opener(payload))
    assert path.read_bytes() == before


def test_a_page_larger_than_the_index_is_not_read():
    with pytest.raises(LiveryError):
        table.fetch(opener=Opener(b"x" * (table.MAX_PAGE_BYTES + 1)))


def test_a_value_that_would_leave_its_column_is_not_written(tmp_path):
    path = tmp_path / "paint_templates.tsv"
    with pytest.raises(LiveryError):
        table.write([cars.TemplateRow("Two\tNames", "car", "C", "1", f"{HOST}/1_template_C.zip")], path)
    assert not path.exists() and not list(tmp_path.glob("*.part"))


def test_the_index_being_sent_on_to_another_host_is_not_followed():
    handler = table._StayWithTheIndex()
    request = urllib.request.Request(table.INDEX)
    for elsewhere in ("https://example.com/cartemplates", f"http://{table.INDEX_HOST}/cartemplates"):
        with pytest.raises(LiveryError):
            handler.redirect_request(request, None, 302, "Found", {}, elsewhere)
    onward = handler.redirect_request(request, None, 302, "Found", {}, f"https://{table.INDEX_HOST}/templates")
    assert onward.full_url == f"https://{table.INDEX_HOST}/templates"


def test_a_certificate_is_checked_and_so_is_the_name_on_it():
    context = net.trust()
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_only_roots_are_trusted_never_an_intermediate_windows_has_collected(monkeypatch):
    root, other_use, not_a_certificate = b"root", b"for-email-only", b"a-revocation-list"
    monkeypatch.setattr(ssl, "enum_certificates", lambda store: {
        "ROOT": [(root, "x509_asn", True), (root + b"2", "x509_asn", {net.SERVER_AUTH}),
                 (other_use, "x509_asn", {"1.3.6.1.5.5.7.3.4"}), (not_a_certificate, "pkcs_7_asn", True)],
        "CA": [(b"collected-intermediate", "x509_asn", True)],
    }[store], raising=False)
    assert net.windows_roots() == [root, root + b"2"]


def test_where_windows_has_no_roots_to_give_pythons_own_are_used(monkeypatch):
    monkeypatch.setattr(ssl, "enum_certificates", lambda store: [], raising=False)
    net.trust.cache_clear()
    try:
        context = net.trust()
        assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname is True
    finally:
        net.trust.cache_clear()


@pytest.mark.skipif(not hasattr(ssl, "enum_certificates"), reason="the stores are Windows'")
def test_on_this_machine_every_certificate_trusted_is_a_root():
    net.trust.cache_clear()
    held = net.trust().get_ca_certs()
    assert held, "no roots were taken from the machine"
    assert all(c["subject"] == c["issuer"] for c in held)
