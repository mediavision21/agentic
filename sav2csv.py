#!/usr/bin/env python3
# SPSS .sav file parser and CSV converter
# Reference: https://www.gnu.org/software/pspp/pspp-dev/html_node/System-File-Format.html

import struct
import sys
import csv
import math
from pathlib import Path

SYSMIS = -1.7976931348623157e+308


def trim_right(s):
    return s.rstrip()


class BufferReader:
    def __init__(self, data):
        self.data = memoryview(data) if isinstance(data, (bytes, bytearray)) else data
        self.offset = 0
        self.little_endian = True  # default

    def _endian(self):
        return '<' if self.little_endian else '>'

    def read_bytes(self, n):
        result = bytes(self.data[self.offset:self.offset + n])
        self.offset += n
        return result

    def read_string(self, n):
        raw = self.read_bytes(n)
        # try utf-8 first, fallback to latin-1
        try:
            return raw.decode('utf-8')
        except UnicodeDecodeError:
            return raw.decode('latin-1')

    def read_int32(self):
        raw = self.read_bytes(4)
        return struct.unpack(self._endian() + 'i', raw)[0]

    def read_float64(self):
        raw = self.read_bytes(8)
        return struct.unpack(self._endian() + 'd', raw)[0]

    def skip(self, n):
        self.offset += n

    def has_more(self):
        return self.offset < len(self.data)


def parse_header(reader):
    magic = reader.read_string(4)
    if magic not in ('$FL2', '$FL3'):
        raise ValueError(f'Not a valid SPSS .sav file (magic: {magic})')

    product_name = trim_right(reader.read_string(60))

    layout_code = reader.read_int32()
    if layout_code == 2:
        reader.little_endian = True
    elif layout_code == 3:
        reader.little_endian = False
    else:
        swapped = ((layout_code & 0xff) << 24) | ((layout_code & 0xff00) << 8) | \
                  ((layout_code & 0xff0000) >> 8) | ((layout_code >> 24) & 0xff)
        if swapped == 2:
            reader.little_endian = False

    nominal_case_size = reader.read_int32()
    compression = reader.read_int32()
    weight_index = reader.read_int32()
    ncases = reader.read_int32()
    bias = reader.read_float64()
    creation_date = trim_right(reader.read_string(9))
    creation_time = trim_right(reader.read_string(8))
    file_label = trim_right(reader.read_string(64))
    reader.skip(3)

    return {
        'magic': magic,
        'product_name': product_name,
        'nominal_case_size': nominal_case_size,
        'compression': compression,
        'weight_index': weight_index,
        'ncases': ncases,
        'bias': bias,
        'creation_date': creation_date,
        'creation_time': creation_time,
        'file_label': file_label
    }


def parse_variable_record(reader):
    vtype = reader.read_int32()
    has_var_label = reader.read_int32()
    n_missing_values = reader.read_int32()
    print_format = reader.read_int32()
    write_format = reader.read_int32()
    name = trim_right(reader.read_string(8))

    label = None
    if has_var_label == 1:
        label_len = reader.read_int32()
        label = trim_right(reader.read_string(label_len))
        padded = math.ceil(label_len / 4) * 4
        if padded > label_len:
            reader.skip(padded - label_len)

    missing_values = []
    abs_missing = abs(n_missing_values)
    for _ in range(abs_missing):
        missing_values.append(reader.read_float64())

    return {
        'type': vtype,
        'name': name,
        'label': label,
        'n_missing_values': n_missing_values,
        'missing_values': missing_values,
        'print_format': print_format,
        'write_format': write_format
    }


def parse_value_label_record(reader, variables):
    label_count = reader.read_int32()
    labels = []

    for _ in range(label_count):
        value = reader.read_float64()
        label_len = reader.read_bytes(1)[0]
        raw_label = trim_right(reader.read_string(label_len))
        total_len = 1 + label_len
        padded = math.ceil(total_len / 8) * 8
        if padded > total_len:
            reader.skip(padded - total_len)
        labels.append({'value': value, 'label': raw_label})

    rec_type4 = reader.read_int32()
    if rec_type4 != 4:
        raise ValueError(f'Expected record type 4 after value labels, got {rec_type4}')

    var_count = reader.read_int32()
    var_indices = []
    for _ in range(var_count):
        var_indices.append(reader.read_int32())

    return {'labels': labels, 'var_indices': var_indices}


def parse_extension_record(reader):
    subtype = reader.read_int32()
    size = reader.read_int32()
    count = reader.read_int32()
    data_len = size * count
    data = None

    if subtype in (13, 14, 20):
        data = trim_right(reader.read_string(data_len))
    else:
        reader.skip(data_len)

    return {'subtype': subtype, 'size': size, 'count': count, 'data': data}


def find_prev_string_slot(slots, idx):
    for i in range(idx - 1, -1, -1):
        if slots[i]['type'] == 'string':
            return slots[i]
    return None


def read_compressed_data(reader, header, variables):
    bias = header['bias']
    slots = []
    for v in variables:
        if v['type'] == -1:
            slots.append({'type': 'string-cont'})
        elif v['type'] == 0:
            slots.append({'type': 'numeric', 'variable': v})
        else:
            slots.append({'type': 'string', 'variable': v, 'width': v['type']})

    rows = []
    bytecodes = []
    bc_index = [0]  # mutable container

    def next_bytecode():
        if bc_index[0] >= len(bytecodes):
            bytecodes.clear()
            bytecodes.extend(reader.read_bytes(8))
            bc_index[0] = 0
        val = bytecodes[bc_index[0]]
        bc_index[0] += 1
        return val

    ncases = header['ncases'] if header['ncases'] > 0 else float('inf')

    while len(rows) < ncases:
        row = {}
        slot_idx = 0
        done = False

        while slot_idx < len(slots):
            slot = slots[slot_idx]
            try:
                code = next_bytecode()
            except Exception:
                done = True
                break

            if code == 0:
                slot_idx += 1
            elif code == 252:
                done = True
                break
            elif code == 253:
                if slot['type'] == 'numeric':
                    val = reader.read_float64()
                    if val == SYSMIS or abs(val - SYSMIS) < 1e+290:
                        row[slot['variable']['name']] = None
                    else:
                        row[slot['variable']['name']] = val
                elif slot['type'] == 'string':
                    s = reader.read_string(8)
                    name = slot['variable']['name']
                    if name not in row:
                        row[name] = s
                    else:
                        row[name] += s
                else:
                    prev = find_prev_string_slot(slots, slot_idx)
                    if prev:
                        row[prev['variable']['name']] += reader.read_string(8)
                    else:
                        reader.skip(8)
                slot_idx += 1
            elif code == 254:
                if slot['type'] == 'string':
                    name = slot['variable']['name']
                    if name not in row:
                        row[name] = '        '
                    else:
                        row[name] += '        '
                elif slot['type'] == 'string-cont':
                    prev = find_prev_string_slot(slots, slot_idx)
                    if prev:
                        row[prev['variable']['name']] += '        '
                slot_idx += 1
            elif code == 255:
                if slot['type'] == 'numeric':
                    row[slot['variable']['name']] = None
                slot_idx += 1
            else:
                if slot['type'] == 'numeric':
                    row[slot['variable']['name']] = code - bias
                slot_idx += 1

        # trim strings
        for key in row:
            if isinstance(row[key], str):
                row[key] = trim_right(row[key])

        if row:
            rows.append(row)

        if done:
            break

    return rows


def read_uncompressed_data(reader, header, variables):
    slots = []
    for v in variables:
        if v['type'] == -1:
            slots.append({'type': 'string-cont'})
        elif v['type'] == 0:
            slots.append({'type': 'numeric', 'variable': v})
        else:
            slots.append({'type': 'string', 'variable': v, 'width': v['type']})

    rows = []
    ncases = header['ncases'] if header['ncases'] > 0 else 100000

    for _ in range(ncases):
        row = {}
        try:
            for i, slot in enumerate(slots):
                if slot['type'] == 'numeric':
                    val = reader.read_float64()
                    if val == SYSMIS or abs(val - SYSMIS) < 1e+290:
                        row[slot['variable']['name']] = None
                    else:
                        row[slot['variable']['name']] = val
                elif slot['type'] == 'string':
                    s = reader.read_string(8)
                    name = slot['variable']['name']
                    if name not in row:
                        row[name] = s
                    else:
                        row[name] += s
                else:
                    prev = find_prev_string_slot(slots, i)
                    if prev:
                        row[prev['variable']['name']] += reader.read_string(8)
                    else:
                        reader.skip(8)
        except Exception:
            break

        for key in row:
            if isinstance(row[key], str):
                row[key] = trim_right(row[key])

        if row:
            rows.append(row)

    return rows


def parse_sav(data):
    reader = BufferReader(data)
    header = parse_header(reader)

    variables = []
    value_labels = []
    extensions = {}
    long_var_names = None

    # parse dictionary records
    parsing = True
    while parsing:
        rec_type = reader.read_int32()

        if rec_type == 2:
            variables.append(parse_variable_record(reader))
        elif rec_type == 3:
            value_labels.append(parse_value_label_record(reader, variables))
        elif rec_type == 6:
            n_lines = reader.read_int32()
            reader.skip(n_lines * 80)
        elif rec_type == 7:
            ext = parse_extension_record(reader)
            extensions[ext['subtype']] = ext
            if ext['subtype'] == 13 and ext['data']:
                long_var_names = ext['data']
        elif rec_type == 999:
            reader.read_int32()  # filler
            parsing = False
        else:
            raise ValueError(f'Unknown record type: {rec_type}')

    # build long name map
    name_map = {}
    if long_var_names:
        for pair in long_var_names.split('\t'):
            parts = pair.split('=')
            if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                name_map[parts[0].strip()] = parts[1].strip()

    # very long string widths
    very_long_strings = {}
    if 14 in extensions and extensions[14]['data']:
        entries = [s for s in extensions[14]['data'].split('\0') if s]
        for entry in entries:
            parts = entry.split('=')
            if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                very_long_strings[parts[0].strip()] = int(parts[1].strip())

    # segment variable names for very long strings
    segment_var_names = set()
    for base_name, total_width in very_long_strings.items():
        seg_count = math.ceil(total_width / 252)
        for s in range(1, seg_count):
            suffix = str(s).zfill(3)
            seg_name = (base_name[:5] + suffix).upper()
            segment_var_names.add(seg_name)

    # real variables (exclude continuations and segments)
    real_variables = [v for v in variables if v['type'] != -1 and v['name'] not in segment_var_names]
    for v in real_variables:
        v['long_name'] = name_map.get(v['name'], v['name'])

    # apply value labels
    for vl in value_labels:
        for idx in vl['var_indices']:
            v = variables[idx - 1]
            if v:
                v['value_labels'] = {l['value']: l['label'] for l in vl['labels']}

    # read data
    if header['compression'] == 1:
        rows = read_compressed_data(reader, header, variables)
    else:
        rows = read_uncompressed_data(reader, header, variables)

    # merge continuations and very long string segments
    mapped_rows = []
    for row in rows:
        new_row = {}
        for v in real_variables:
            long_name = v['long_name']
            if v['type'] > 0:
                full_str = row.get(v['name'], '')
                base_idx = variables.index(v)
                for ci in range(base_idx + 1, len(variables)):
                    if variables[ci]['type'] == -1:
                        val = row.get(variables[ci]['name'])
                        if val is not None:
                            full_str += val
                    else:
                        break

                if v['name'] in very_long_strings:
                    total_width = very_long_strings[v['name']]
                    seg_count = math.ceil(total_width / 252)
                    for s in range(1, seg_count):
                        suffix = str(s).zfill(3)
                        seg_name = (v['name'][:5] + suffix).upper()
                        seg_idx = next((i for i, sv in enumerate(variables) if sv['name'] == seg_name), -1)
                        if seg_idx >= 0:
                            full_str += row.get(seg_name, '')
                            for ci in range(seg_idx + 1, len(variables)):
                                if variables[ci]['type'] == -1:
                                    val = row.get(variables[ci]['name'])
                                    if val is not None:
                                        full_str += val
                                else:
                                    break

                new_row[long_name] = trim_right(full_str)
            else:
                new_row[long_name] = row.get(v['name'])
        mapped_rows.append(new_row)

    encoding = extensions[20]['data'] if 20 in extensions else None

    return {
        'header': header,
        'variables': real_variables,
        'rows': mapped_rows,
        'encoding': encoding,
        'total_cases': len(mapped_rows),
        'total_variables': len(real_variables)
    }


def format_value(val):
    # format numeric: drop .0 for integers
    if val is None:
        return ''
    if isinstance(val, float):
        if val == int(val):
            return str(int(val))
    return str(val)


def sav_to_csv(sav_path, csv_path=None):
    sav_path = Path(sav_path)
    if csv_path is None:
        csv_path = sav_path.with_suffix('.csv')
    else:
        csv_path = Path(csv_path)

    data = sav_path.read_bytes()
    result = parse_sav(data)

    columns = [v['long_name'] for v in result['variables']]

    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        for row in result['rows']:
            writer.writerow([format_value(row.get(col)) for col in columns])

    print(f'{result["total_cases"]} rows x {result["total_variables"]} columns -> {csv_path}')
    return csv_path


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python sav2csv.py <input.sav> [output.csv]')
        sys.exit(1)

    sav_file = sys.argv[1]
    csv_file = sys.argv[2] if len(sys.argv) > 2 else None
    sav_to_csv(sav_file, csv_file)
